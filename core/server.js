var sys = require('util'),
	fs = require('fs'),
	log = require('simple-logger'),
	utils = require('./lib/utils'),
	templater = require('./lib/templater'),
    db = require('./lib/couch-bone'),
    permissions = require('./permissions'),
    cache = require('./lib/cache'),
	express = require('express'),
    q = require('q'),
    Frayme = require('./models/rayframe'),
    frayme = module.exports,
    viewsToCreate = [];

exports.createServer = function(options, cb) {
    log.level = 'info';

    // Set up express and couch and defaults
    var server = express(),
        // TODO: If couch isn't running we just get a top level exception thrown on first access atempt. Would be nice to
        // tell user to start couch.
        theme = options.theme || 'ray-frame',
        core_static = 'core/static/',
        user_static = 'user/themes/' + theme + '/static/';

    db.connect(options.db_name || 'rayframe');

    this.debug = options.debug;
    this.express = server;

    templater.couch = db;
    templater.debug = this.debug;

    cache.db = db;

    server.configure(function() {
        server.use(express.bodyParser());
        server.use(express.cookieParser());
        server.use(express.session({secret: options.secret}));

        server.use(express['static'](__dirname + '/../' + user_static));
        server.use(express['static'](__dirname + '/../' + core_static));
    });

    // Listen for all references, which we turn into couch views
    Frayme.on('newModel:Reference', function(model) {
        viewsToCreate.push(model);
    });

    q.fcall(function() {
        if(options.hard_reset) {
            return frayme.resetDatabase();
        }
    // Save all view references if they don't exist
    }).then(function() {
        return db.get('_design/master').then(function(doc) {
            viewsToCreate.forEach(function(model) {
                var name = model.serialize();
                if(!doc.views[name]) {
                    doc.views[name] = {
                        map: 'function(doc) {' +
                            'if(doc.model) {' +
                                'var models = {"' + model.references().join('": 1,"') + '": 1};' +
                                'if(doc.model in models) {' +
                                    'emit(doc.parent, doc);' +
                                '}' +
                            '}' +
                        '}'
                    };
                }
            });
            return db.save('_design/master', doc);
        });
    }).then(function() {
        // This is the core of URL routing functionality. Set up a handler for static files
        server.get(/.*/, function(req, res) {
            var dbPath = utils.sanitizeUrl(req.url);
            utils.authSession(req);

            // This is the handler for any web page. There are URL objects in the database that we look up. So basically every
            // URL on the site has its own URL object which contains the id to the model object, and a parent chain of other
            // URL objects so we can say, build a breadcrumb trail
            db.view('master/url', {key: dbPath}).then(function(result) {
                var found = result.rows.length,
                    model;
                if(found === 1) {
                    model = result.rows[0].value;
                    templater.render(model.template, req.session.user, model, function(err, parsed) {
                        if(err) {
                            log.error('Error serving template for `' + req.url + '` (CouchDB key `' + dbPath + '`): ',err);
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

                    res.write('<html><head><link href="/rainbow.css" rel="stylesheet" type="text/css"></head><body>');

                    // Temporary: log all the compiled templates in the system
                    for(var template in templater.rawCache) {
                        if(template.indexOf('admin') > -1) {
                            res.write(
                            '<br /><br /><h2>' + template + '</h2><hr /><pre><code data-language="javascript">'
                                + templater.rawCache[template].compiled.toLocaleString().replace(/;/g, ';\n')
                                + '</code></pre>');
                        }
                    }
                    res.end('Todo: This should be some standardized 404 page' +
                        '<script src="/rainbow.js"></script></body></html>');
                }
            }).fail(function(err) {
                log.error('Error fetching URL view `' + dbPath + '`: ',err);
                res.writeHead(500, {'Content-Type': 'text/html'});
                res.end('Internal server errrrrrror');
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
            var t = './transients.js', x;
            fs.exists(t, function(ya) {
                if(ya) {
                    var transients = require(t);
                    for(var trans in transients) {
                        templater.addTransientFunction(trans, transients[x]);
                    }
                }
                templater.addNamespace('utils');
                // Also copy over all the utility functions to be transients
                for(var thing in utils) {
                    templater.addNamespacedTransientFunction('utils', thing, utils[thing]);
                }
                frayme.setUpAccess(server);

                // Here we go!
                server.listen(options.server_port || 8080);
                log.info('Server running on ' + (options.server_port || 8080) + '!');

                if(cb) {
                    cb(null, server);
                }
            });
        });
    })
    .fail(function(err) {
        log.error('Fatal error encounted while trying to reset database: ', err);
    });
};

exports.resetDatabase = function() {
    return db.exists()
        .then(function(exists) {
            if(exists) {
                log.info('Existing database found, deleting for development');
                return db.destroy();
            }
        })
        .then(function() {
            return db.create();
        })
        .then(function() {
            var root = new Frayme.Page({
                _id:'root',
                template:'index.html', title:'home', welcome_msg: 'Velkomen from <i>index.html</i>!', url: '~', parents: [],
                ponies: {balls: {'ducks': 'in the pond', 'quack': 'my quack'}},
                pages: new Frayme.Reference(Frayme.Page)
            });
            return db.save([{
                _id: '_design/master',
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
            },
            // TEST DATA
            root,

            new Frayme.Page({
                _id:'test.html',
                template:'test.html',
                title:'hello',
                welcome_msg: 'Test.html says Velokmen!',
                test_msg: 'Test message!',
                parents: [],
                pages: {
                    ids: ['abcdeft', 'moo']
                },
                blogs: {
                    ids: ['abcdeft', 'moo']
                },
            }),

            new Frayme.Page({
                _id: 'global.html',
                template: 'global.html',
                title: 'hello',
                welcome_msg: 'I am welcome message from global',
                parents: [],
            }),

            //{_id:'header.html', template:'header.html'},
            //{_id:'global.html', template:'global.html', info: 'stuff'}, // another by convention

            // CRAP DATA
            new Frayme.Page({
                _id:'abcdeft', template:'blog.html', title: 'blog post title!', parent: root, body: 'threenis'
            }),
            new Frayme.Page({
                _id:'moo', template:'blog.html', title: 'I should be the first in the array', parent: root
            }),

            //{_id:'ab1', template:'blog.html', title: 'other blog 1 (last)', parent_id: 'root', url: utils.sanitizeUrl('/blogposta')},
            //{_id:'ab2', template:'blog.html', title: 'other blog 2 (first)', parent_id: 'root', url: utils.sanitizeUrl('/blogpostb')},
            //{_id:'ab3', template:'blog.html', title: 'other blog 3 (midle)', parent_id: 'root', url: utils.sanitizeUrl('/blogpostc')},

            // TODO: This should be a core template, overwritable (there currently are no core templates)
            new Frayme.Page({
                _id:'login', template:'login.html', title: 'Log in'
            })
        ]);
    });
};

exports.createPost = function(server, role, prefix, name, functionCall) {

    server.post('/'+(prefix ? prefix+'/' : '')+name, function(req, res) {

        // Have to do this at every entry point
        utils.authSession(req);

        if(utils.isAllowed(permissions, role, req.session.user.role)) {
            server.couch.get([req.body.current_id, req.body.current_url_id], function(err, result) {
                functionCall(req, res, result.rows[0].doc, result.rows[1].doc, server.couch);
            });
        }

    });
};

// Set up access functions for admin AJAX calls
exports.setUpAccess = function(server) {
    permissions.forEach(function(role) {
        for(var functionName in role.accessors) {
            frayme.createPost(server, role.name, role.accessURL || role.name, functionName, role.accessors[functionName]);
        }
    });

    server.post('/login', function(request, response) {
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
