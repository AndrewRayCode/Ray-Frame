var http = require('http'),
	sys = require('sys'),
	redis = require('redis'),
	couch_client = require('../node-couchdb/index.js').createClient(5984, 'localhost'),
	log = require('./lib/logger'),
	utils = require('./lib/utils'),
	templater = require('./lib/templater'),
	fs = require('fs'),
	path = require('path'),
	express = require('express'),
    accessors = require('./access_functions'),
    // TODO: Authentication with login form, maybe user level permissions
	isAdmin = 1;

log.log_level = 'info';
var server = express.createServer();
server.use(express.bodyDecoder());
server.error(function(err, req, res) {
	log.warn('Server error: '+err);
	res.send('what the heck');
});

// Reset the database on every startup for now
var couch = couch_client.db('rayframe');
couch.exists(function(err, exists) {
    function recreate() {
        couch.create(function(err) {
            if(err) {
                log.error(err);
            } else {
                log.info('Recreated database `rayframe`');
                couch = couch_client.db('rayframe');

                // Create a view in a design doc TODO: Is there a way to multi these two calls?
                couch.saveDesign('master', {
                    views: {
                        // Not currently needed, but this is the syntax for a view save
                        'url':{
                            map: function(doc) {
                                if(doc.url) {
                                    emit(doc.url, doc.reference);
                                }
                            }
                        }
                    }
                }, function(err) {
                    // Create our homepage object and url object for it
                    couch.bulkDocs({docs: [
                        // Bulkdocs takes _id, not key
                        {_id:'root', template:'index.html', title:'hello'}, // root is special case. Let couch name other keys for page objects
                        {_id:'global', template:'global.html'}, // another by convention
                        {_id:utils.sanitizeUrl('/'), reference:'root', chain:[]}]}, // TODO: Should URLs get their own database, or view?
                        function(err) {
                            log.info('Welcome to Ray-Frame. Your home page has been automatically added to the database.');
                            runServer();
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

// TODO: Abstract this out into a config file. Roles are descending, so top level (admin) has access to all functions after it
var ROLES = ['admin'],
    ACCESS_PREFIX = '/access'; // Change for one more quip of security

// Set up each external access function as a post with express
ROLES.forEach(function(item) {
    var funcs = accessors.functions[item];

    function createPost(funcName) {
        server.post(ACCESS_PREFIX+'/'+funcName, function(req, res) {
            // TODO: Determine authenticaiton here. Session / cookie based? All higher level roles have access to lower level roles
            if(isAdmin) {
                couch.getDocsByKey([req.body.current_id, req.body.current_url_id], function(err, result) {
                    funcs[funcName](req, res, result.rows[0], result.rows[1], couch);
                });
            }
        });
    };

    // Call closure function on every function for this role
    if(funcs) {
        for(var funcName in funcs) {
            createPost(funcName);
        }
    }
});

server.get(/.*/, function(req, res) {
	var urlPath = req.url.split('/'),
		dbPath = utils.sanitizeUrl(req.url);

    // Static file handling
	if(urlPath[1] == 'static') {
		try {
			res.writeHead(200, {'Content-Type': utils.guessContentType(req.url)});
			// TODO: readFileSync to avoid callback nonsense, but it's unavoidable, so make non-sync?
			res.end(fs.readFileSync(req.url.substring(1)));
		} catch(e) {
			res.writeHead(404, {'Content-Type': 'text/html'});
			res.end('Todo: this should be some standardized 404 page' + e);
		}
	} else {
        //db.view(design, view, [query], [cb])
        couch.getDoc(dbPath, function(err, urlObject) {
            if(err) {
				log.error('Error fetching URL view `'+dbPath+'`: ',err);
				res.writeHead(500, {'Content-Type': 'text/html'});
				res.end('Internal server errrrrrror');
            } else {
                couch.getDoc(urlObject.reference, function(err, page) {
                    if(err) {
                        log.error('!!! URL object found but no page data found ('+urlObject.reference+')!: ',err);
                        res.writeHead(500, {'Content-Type': 'text/html'});
                        res.end('Internal server errrrrrror');
                    } else {
                        serveTemplate(urlObject, page, function(err, parsed) {
                            if(err) {
                                log.error('Error serving template for `'+req.url+'` (CouchDB key `'+dbPath+'`): ',err);
                                res.writeHead(500, {'Content-Type': 'text/html'});
                                res.end('Internal server errrrrrror');
                            } else {
                                res.writeHead(200, {'Content-Type': 'text/html'});
                                res.end(parsed);
                            }
                        });
                    }
                });

            }
        });
	}
});

function runServer() {
    templater.setReferences(isAdmin);
	server.listen(8080);
	log.info('Server running!');
}

// Serve a template from cache or get new version
function serveTemplate(urlObj, pageData, cb) {
	// TODO: Right now we are forcing the recreation of the template from disk. Original plan was to store those parsed files in compiled/ directory. Look into this
	templater.parseTemplate(urlObj, pageData, true, cb);
    
	//try {
		//var f = fs.readFileSync('compiled/'+obj.template);
		//return f;
	//} catch(e) {
		//return parseTemplate(obj);
	//}
}
