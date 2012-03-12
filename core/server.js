var http = require('http'),
	sys = require('sys'),
	fs = require('fs'),
	path = require('path'),
	log = require('simple-logger'),
	utils = require('./lib/utils'),
	templater = require('./lib/templater'),
    permissions = require('./permissions'),
    cache = require('./lib/cache'),
    flower = require('./lib/flower'),
	express_lib = require('express'),
    server = module.exports;

exports.createServer = function(options, cb) {
    log.log_level = 'info';

    // Set up express and couch and defaults
    var express = express_lib.createServer(),
        // TODO: If couch isn't running we just get a top level exception thrown on first access atempt. Would be nice to
        // tell user to start couch.
        couch_client = require('node-couchdb').createClient(5984, 'localhost'),
        couch = couch_client.db(options.db_name || 'rayframe'),
        theme = options.theme || 'ray-frame',
        core_static = 'core/static/',
        user_static = 'user/themes/' + theme + '/static/';

    this.debug = options.debug;
    this.couch = couch;
    this.express = express;

    templater.couch = couch;
    templater.debug = this.debug;

    cache.couch = couch;

    //log.error( __dirname + '/../' + user_static);

    express.configure(function(){
        express.use(express_lib.bodyParser());
        express.use(express_lib.cookieParser());
        express.use(express_lib.session({secret: options.secret}));

        express.use(express_lib['static'](__dirname + '/../' + user_static));
        express.use(express_lib['static'](__dirname + '/../' + core_static));
    });

    // This should be defined in a non-testing environment. For debugging we want stack traces
    //express.error(function(err, req, res) {
        //log.warn('Server error: '+err);
        //res.send('what the heck');
    //});

    // Internal functions can have silly names, right?
    function prepareForGoTime() {
        // This is the core of URL routing functionality. Set up a handler for static files
        express.get(/.*/, function(req, res) {
            var urlPath = req.url.split('/'),
                dbPath = utils.sanitizeUrl(req.url);
            utils.authSession(req);

            // This is the handler for any web page. There are URL objects in the database that we look up. So basically every
            // URL on the site has its own URL object which contains the id to the model object, and a parent chain of other
            // URL objects so we can say, build a breadcrumb trail
            couch.view('master', 'url', {key: dbPath}, function(err, result) {
                if(err) {
                    log.error('Error fetching URL view `'+dbPath+'`: ',err);
                    res.writeHead(500, {'Content-Type': 'text/html'});
                    res.end('Internal server errrrrrror');
                } else {
                    var found = result.rows.length;
                    if(found == 1) {
                        server.serveTemplate(req.session.user, result.rows[0].value, function(err, parsed) {
                            if(err) {
                                log.error('Error serving template for `'+req.url+'` (CouchDB key `'+dbPath+'`): ',err);
                                res.writeHead(500, {'Content-Type': 'text/html'});
                                res.end('Internal server errrrrrror');
                            } else {
                                res.writeHead(200, {'Content-Type': 'text/html'});
                                res.end(parsed);
                            }
                        });
                    } else if(found > 1) {
                        log.error('Wtf? `' + dbPath + '`: ',result.rows);
                        res.writeHead(500, {'Content-Type': 'text/html'});
                        res.end('Internal server errrrrrror');
                    } else {
                        log.warn('Non-existant page was requested (404): `'+dbPath+'`');
                        res.writeHead(404, {'Content-Type': 'text/html'});

                        // Temporary: log all the compiled templates in the system
                        for(var template in templater.rawCache) {
                            if(template.indexOf('admin') > -1) {
                                res.write('<br /><br /><b>' + template + '</b><hr /><code>'
                                    + templater.rawCache[template].compiled.toLocaleString().replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[^t];/g, '$&<br />')
                                + '</code>');
                            }
                        }
                        res.end('Todo: This should be some standardized 404 page');
                    }
                }
            });
        });

        // Tell our template library what theme to use
        templater.addTransientFunction('getInstructions', templater.getInstructions);

        var hasErrored;
        templater.cacheTheme(theme, permissions, function(err) {
            if(err && !hasErrored) {
                hasErrored = true;
                return log.error('Error setting theme!: ',err);
            } else if(hasErrored) {
                return;
            }
            templater.autoRevalidate();

            // Set up our transient functions (functions that can run server and client side, right now for core live in transient.js);
            var t = './transients.js';
            path.exists(t, function(ya) {
                if(ya) {
                    var transients = require(t);
                    for(var x in transients) {
                        templater.addTransientFunction(x, transients[x]);
                    }
                }
                templater.addNamespace('utils');
                // Also copy over all the utility functions to be transients
                for(var x in utils) {
                    templater.addNamespacedTransientFunction('utils', x, utils[x]);
                }
                server.setUpAccess(express);

                // Here we go!
                express.listen(options.server_port || 8080);
                log.info('Server running on '+(options.server_port || 8080)+'!');

                if(cb) {
                    cb(null, server);
                }
            });
        });
    }

    if(options.hard_reset) {
        server.resetDatabase(couch, function(err) {
            if(err) {
                return log.error('Fatal error encounted while trying to reset database: ',err);
            }
            prepareForGoTime();
        });
    } else {
        prepareForGoTime();
    }
};

exports.resetDatabase = function(couch, callback) {
    // Reset the database on every startup for now
    couch.exists(function(err, exists) {
        function recreate() {
            couch.create(function(err) {
                if(err) {
                    log.error('There was a fatal error creating the database! ',err);
                    return callback(err);
                } else {
                    log.info('Recreated database `'+couch.name+'`');

                    // Create a view in a design doc TODO: Is there a way to multi these two calls?
                    couch.saveDesign('master', {
                        views: {
                            // Not currently needed, but this is the syntax for a view save
                            'url':{
                                map: function(doc) {
                                    if(doc.url) {
                                        emit(doc.url, doc);
                                    }
                                }
                            }
                        }
                    }, function(err) {
                        // Create our homepage object and url object for it. Bulkdocs takes _id
                        utils.bulkDocs(couch, [
                            // TEST DATA

                            // root is special case. Let couch name other keys for page objects
                            {_id:'root', template:'index.html', title:'hello', welcome_msg: 'Velokmen!', url: utils.sanitizeUrl('/'),
                                parents: [], blogs: ['ab2', 'ab3', 'ab1'], ponies: {balls: 'chicken'}},
                            {_id:'test.html', template:'test.html', title:'hello', welcome_msg: 'Test says Velokmen!', test_msg: 'Test message!',
                                parents: [], pages: ['moo', 'abcdeft'], blogs: ['ab2', 'ab3', 'ab1']},

                            //{_id:'header.html', template:'header.html'},
                            //{_id:'global.html', template:'global.html', info: 'stuff'}, // another by convention

                            // CRAP DATA
                            {_id:'abcdeft', template:'blog.html', title: 'blog post title!', parent_id: 'root', url: utils.sanitizeUrl('/blogpost'), body: 'threenis'},
                            {_id:'moo', template:'blog.html', title: 'I should be the first in the array', parent_id: 'root', url: utils.sanitizeUrl('/blogpost2')},

                            //{_id:'ab1', template:'blog.html', title: 'other blog 1 (last)', parent_id: 'root', url: utils.sanitizeUrl('/blogposta')},
                            //{_id:'ab2', template:'blog.html', title: 'other blog 2 (first)', parent_id: 'root', url: utils.sanitizeUrl('/blogpostb')},
                            //{_id:'ab3', template:'blog.html', title: 'other blog 3 (midle)', parent_id: 'root', url: utils.sanitizeUrl('/blogpostc')},

                            // TODO: This should be a core template, overwritable (there currently are no core templates)
                            {_id:'login', template:'login.html', title: 'Log in', url: utils.sanitizeUrl('/login')}
                        ], function(err) {
                            log.info('Database reset complete. The homepage (index.html) has been automatically added.');
                            callback(err);
                        });
                    });
                }
            });
        }

        if(exists) {
            log.info('Existing database found, deleting for development');
            couch.remove(recreate);
        } else {
            recreate();
        }
    });
};

exports.createPost = function(express, role, prefix, name, functionCall) {

    express.post('/'+(prefix ? prefix+'/' : '')+name, function(req, res) {

        // Have to do this at every entry point
        utils.authSession(req);

        if(utils.isAllowed(permissions, role, req.session.user.role)) {
            server.couch.getDocsByKey([req.body.current_id, req.body.current_url_id], function(err, result) {
                functionCall(req, res, result.rows[0].doc, result.rows[1].doc, server.couch);
            });
        }

    });
};

// Set up access functions for admin AJAX calls
exports.setUpAccess = function(express) {
    permissions.forEach(function(role) {
        for(var functionName in role.accessors) {
            server.createPost(express, role.name, role.accessURL || role.name, functionName, role.accessors[functionName]);
        }
    });

    express.post('/login', function(request, response) {
        if(request.body.username == 'bob' && request.body.password == 'saget') {
            request.session.user = {
                name: 'bob',
                role: 'admin',
                auth: true
            };
            response.writeHead(302, {
                'Location': '/'
            });
            response.end();
        } else {
            response.writeHead(302, {
                'Location': '/login'
            });
            response.end();
        }
    });
};

// Serve a template from cache or get new version
exports.serveTemplate = function(user, pageData, cb) {
    var data = {
        blocks: {
            extender: {}
        }
    };

    data[pageData._id] = {
        model: pageData,
        locals: {a:3}
    };

    //log.error('serving ',pageData.template + user.role);
    //console.log(templater.templateCache[pageData.template + user.role].toLocaleString());

    // function('cache', 'templater', 'user', 'pageId', 'data', 'cb');
    templater.templateCache[pageData.template + user.role](cache, templater, user, pageData._id, data, function(err, txt) {
        if(err) {
            cb(null, err.stack.replace(/\n/g, '<br />')
                + '<hr />'
                + templater.rawCache[pageData.template + user.role].compiled.toLocaleString().replace(/</g, '&lt;').replace(/>/g, '&gt;')
                + '<hr />');
        } else {
            cb(err, txt);
        }
    });
};
