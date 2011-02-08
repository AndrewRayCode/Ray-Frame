var http = require('http'),
	sys = require('sys'),
	redis = require('redis'),
	couch_client = require('couchdb').createClient(5984, 'localhost'),
	log = require('./lib/logger'),
	fs = require('fs'),
	path = require('path'),
	express = require('express'),
	isAdmin = 1, // TODO: Authentication with login form, maybe user level permissions
	adminFiles = '<script src="/static/admin/jquery-1.5.min.js"></script><script src="/static/admin/admin_functions.js"></script><link rel="stylesheet" href="/static/admin/admin.css" />';

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
                log.error(sys.inspect(err));
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
                        {_id:sanitizeUrl('/'), reference:'root', chain:[]}]}, // TODO: Should URLs get their own database, or view?
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


// TODO: This all needs to be one entry point for simpler authentication
server.post('/update', updateField);
server.post('/addListPage', addListPage);
server.post('/removeListPage', removeListPage);
server.post('/getTemplates', getTemplates);
server.post('/getView', getView);

server.get(/.*/, function(req, res) {
	var path = req.url.split('/'),
		dbPath = sanitizeUrl(req.url);

    // Static file handling
	if(path[1] == 'static') {
		try {
			res.writeHead(200, {'Content-Type': guessContentType(req.url)});
			// TODO: readFileSync to avoid callback nonsense, but it's unavoidable, so make non-sync
			res.end(fs.readFileSync(req.url.substring(1)));
		} catch(e) {
			res.writeHead(404, {'Content-Type': 'text/html'});
			res.end('Todo: this should be some standardized 404 page' + e);
		}
	} else {
        //db.view(design, view, [query], [cb])
        couch.getDoc(dbPath, function(err, urlObject) {
            if(err) {
				log.error('Error fetching URL view `'+dbPath+'`: '+sys.inspect(err));
				res.writeHead(500, {'Content-Type': 'text/html'});
				res.end('Internal server errrrrrror');
            } else {
                couch.getDoc(urlObject.reference, function(err, page) {
                    if(err) {
                        log.error('!!! URL object found but no page data found ('+urlObject.reference+')!: '+sys.inspect(err));
                        res.writeHead(500, {'Content-Type': 'text/html'});
                        res.end('Internal server errrrrrror');
                    } else {
                        serveTemplate(urlObject, page, function(err, parsed) {
                            if(err) {
                                log.error('Error serving template for `'+req.url+' (CouchDB key `'+dbPath+'`): '+sys.inspect(err));
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
	server.listen(8080);
	log.info('Server running!');
}

// Serve a template from cache or get new version
function serveTemplate(urlObj, pageData, cb) {
	// TODO: Right now we are forcing the recreation of the template from disk. Original plan was to store those parsed files in compiled/ directory. Look into this
	parseTemplate(urlObj, pageData, true, cb);
    
	//try {
		//var f = fs.readFileSync('compiled/'+obj.template);
		//return f;
	//} catch(e) {
		//return parseTemplate(obj);
	//}
}

// Regex to find {{ stuff }}
var modelReplaces = /\{\{\S+?\}\}/g;

// Put the template into compiled and return the parsed data
function parseTemplate(urlObj, pageData, canHaveGlobal, cb) {
    var f, child, globalData;
    // First read the template from the templates directory
	try {
		f = fs.readFileSync('templates/'+pageData.template).toString();
	} catch(e) {
		cb('Template not found for `'+sys.inspect(pageData)+'`: '+e);
		return;
	}

    // Append the admin files and save the compiled page
    function end(f) {
        if(isAdmin) {
            f = f.replace('</body>', adminFiles+'</body>');
        }
        fs.writeFileSync('compiled/'+urlObj._id, f);
        cb(null, f);
    }
    // Function to handle a global object if we have one (think template with header, footer, etc)
    function replaceGlobal(f) {
        var matches = f.match(modelReplaces);
        if(matches) {
            // Find out what we are trying to insert
            var instr = getInstructions(matches[0]);
            // Use special child directive to reference object this global wraps
            if(instr.field == 'child') {
                // If it has an attribute like child.title
                if(instr.attr) {
                    getData(urlObj, matches[0].replace('child.', ''), pageData, function(err, val) {
                        f = f.replace(matches[0], val);
                        replaceGlobal(f);
                    });
                // Otherwise this is where we put the child in the template
                } else {
                    f = f.replace(matches[0], child);
                    replaceGlobal(f);
                }
            } else {
                getData(urlObj, matches[0], globalData, function(err, val) {
                    f = f.replace(matches[0], val);
                    replaceGlobal(f);
                });
            }
        } else {
            end(f);
        }
    }

    // Recursive replace funciton to update document TODO: Replace with HTML parser?
	function replace(f) {
		var matches = f.match(modelReplaces);
		if(matches) {
            // Replace the {{ .. }} with whatever it's supposed to be
			getData(urlObj, matches[0], pageData, function(err, val) {
				f = f.replace(matches[0], val);
				replace(f, matches);
			});
        } else if(canHaveGlobal) {
            couch.getDoc('global', function(err, doc) {
                if(doc) {
                    child = f;
                    globalData = doc;
                    var g = fs.readFileSync('templates/'+globalData.template).toString();
                    replaceGlobal(g);
                } else {
                    end(f);
                }
            });
		} else {
            end(f);
        }
	}
	replace(f);
}

function getData(urlObject, str, pageData, cb) {
	var instructions = getInstructions(str);
		val = pageData[instructions.field] || '';
	// If this is an included file we need to start the parse chain all over again
	if(instructions.include) {
		var lookup = 'includes'+instructions.field;
		getOrCreate(lookup, instructions.field, function(err, obj) {
			if(err) {
				cb(err);
			} else {
                parseTemplate(urlObject, obj, false, cb);
			}
		});
	} else if(isAdmin) {
		if(instructions.list) {
			cb(null, '<span class="edit_list" id="'+pageData._id+':'+instructions.raw+'">'+val+'</span>');
		} else if(!instructions.noEdit) {
			cb(null, '<span class="edit_me" id="'+pageData._id+':'+instructions.raw+'">'+val+'</span>');
		} else {
			cb(null, val);
		}
	} else {
		cb(null, val);
	}
}

// Parse a "plip" which is anything in {{ }} on a template
function getInstructions(plip) {
	var raw = plip.substring(2, plip.length-2),
		fields = raw.split(':'),
        l = fields.length,
        split = fields[0].split('.'),
        conclusion = {
            field: fields[0],
            raw: raw,
            noEdit: fields.indexOf('noEdit') > -1 ? true : false,
            list: fields[1] == 'list' ? true : false,
        };


    //TODO: better way to identify {{template.html}} import
    if(split[1] == 'html') {
        conclusion.include = true;
    } else {
        conclusion.attr = split[1] ? split[1] : null;
        // If this isn't an include it could have things like `view=a.html` or `type=blog`
        while(l--) {
            var s = fields[l].split('=');
            if(s.length > 1) {
                conclusion[s[0]] = s[1];
            }
        }
    }

    return conclusion;
}

function guessContentType(file) {
	var ext = path.extname(file);
	if(ext == '.css') {
		return 'text/css';
	} else if(ext == '.js') {
		return 'text/javascript';
	}
}

function addListPage(req, res) {

}

function removeListPage(req, res) {

}

function getView(req, res) {
	getOrCreate(sanitizeUrl(req.url)+req.body.view, req.body.view, function(err, obj) {
		if(err) {
			res.send({status:'failure', message:err});
		} else {
			serveTemplate(sanitizeUrl(req.url), obj, function(err, parsed) {
				if(err) {
					res.send({status:'failure', message:err});
				} else {
					res.send({status:'success', parsed:parsed});
				}
			});
		}
	});
}

function getTemplates(req, res) {
	fs.readdir('templates/', function(err, files) {
		if(err) {
			res.send({status:'failure', message:err.message});
		} else {
			var clean = [];
			// Filter out VIM swap files for example
			for(var x=0; x<files.length; x++) {
				if(/\.html$/.test(files[x])) {
					clean.push(files[x]);
				}
			}
			res.send({status:'success', templates:clean});
		}
	});
}

function updateField(req, res) {
	var parts = req.body.field.split(':');

	couch.getDoc(parts[0], function(err, doc) {
		doc[parts[1]] = req.body.value;
		couch.saveDoc(doc._id, doc, function(err, dbres) {
			if(err) {
				res.send({status:'failure', message:err});
			} else {
				res.send({status:'success', new_value:req.body.value});
			}
		});
	});
}

// Couch can't handle `/` in keys, so relace with `~`
function sanitizeUrl(str) {
    // Never have leading or trailing `.`s, except homepage which is just '~'
    return str.replace(/\//g, '~').replace(/(.+)~$/, '$1').replace(/^~(.+)/, '$1');
}

function getOrCreate(path, template, cb) {
	couch.getDoc(path, function(err, firstres) {
		if(err) {
			// This thing is not yet in the database. Let's put it there!
			var new_obj = {template: template};
			// TODO: Here we create the db entry even if the template file does not exist.
			// We should check for it and error up there if it doesn't exist
			couch.saveDoc(path, new_obj, function(err, added) {
				cb(err, new_obj);
			});
		} else {
			cb(null, firstres);
		}
	});
}
