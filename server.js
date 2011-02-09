var http = require('http'),
	sys = require('sys'),
	redis = require('redis'),
	couch_client = require('../node-couchdb/index.js').createClient(5984, 'localhost'),
	log = require('./lib/logger'),
	utils = require('./lib/utils'),
	fs = require('fs'),
	path = require('path'),
	express = require('express'),
    accessors = require('./access_functions'),
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
                couch.getDocsByKey([req.body.current_id, req.body.curent_url_id], function(err, result) {
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
                                log.error('Error serving template for `'+req.url+' (CouchDB key `'+dbPath+'`): ',err);
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
		cb('Template not found for `',pageData,'`: ',e);
		return;
	}

    // Append the admin files and save the compiled page
    function end(f) {
        if(isAdmin) {
            // Add admin files to front end, and pass variables about current ids for page context. TODO: This is shittacular on so many levels
            f = f.replace('</body>', adminFiles+'<script>var current_id="'+pageData._id+'", current_url_id="'+urlObj._id+'", access_url="'+ACCESS_PREFIX+'";</script></body>');
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
                        // TODO: Man, you know what, I'd rather just throw this junk, this doesn't feel DRY
                        if(err) {
                            cb(err);
                        } else {
                            f = f.replace(matches[0], val);
                            replaceGlobal(f);
                        }
                    });
                // Otherwise this is where we put the child in the template
                } else {
                    f = f.replace(matches[0], child);
                    replaceGlobal(f);
                }
            } else {
                getData(urlObj, matches[0], globalData, function(err, val) {
                    if(err) {
                        cb(err);
                    } else {
                        f = f.replace(matches[0], val);
                        replaceGlobal(f);
                    }
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
                if(err) {
                    cb(err);
                } else {
                    f = f.replace(matches[0], val);
                    replace(f, matches);
                }
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

// Get the data from an object and replace it into its proper plip, like {{ }}. Also handles includes
function getData(urlObject, plip, pageData, cb) {
	var instructions = getInstructions(plip);
		val = pageData[instructions.field] || '';

    // URL is a special magical case, it should become the URL of the item
    if(instructions.field == 'url') {
        cb(null, utils.unsanitizeUrl(urlObject._id, pageData.title));
	// If this is an included file we need to start the parse chain all over again
    } else if(instructions.include) {
		var lookup = 'includes'+instructions.field;
		getOrCreate(lookup, instructions.field, function(err, obj) {
			if(err) {
				cb(err);
			} else {
                parseTemplate(urlObject, obj, false, cb);
			}
		});
	} else if(isAdmin) {
        var edit_id = pageData._id+':'+instructions.raw,
            callback = function(err, val) {
                cb(err, '<span class="edit_list" id="'+edit_id+'">'+val+'</span>');
            };
		if(instructions.list) {
            renderList(instructions, urlObject, pageData, callback);
		} else if(!instructions.noEdit) {
			cb(null, '<span class="edit_me" id="'+edit_id+'">'+val+'</span>');
		} else {
			cb(null, val);
		}
	} else {
		cb(null, val);
	}
}

function renderList(instructions, urlObj, pageData, cb) {
    parseListView(instructions.list_view || 'list.html', function(err, listData) {
        if(err) {
            cb('Error parsing list view: ',err);
        } else {
            var items = pageData[instructions.field],
                template_view = instructions.list_view || 'link.html';
            
            try {
                template = fs.readFileSync('templates/'+template_view).toString();
            } catch(e) {
                cb('Error reading link template `'+template_view+'`: ',e);
            }

            if(items && items.length > 0) {
                // Get the documents in the items array
                // TODO: _all_docs with keys still returns total_rows: total docs in database. Is this really the method I want?
                couch.getDocsByKey(items, function(err, result) {
                    if(err) {
                        cb('Error with bulk document insert: '+sys.inspect(err));
                    } else {
                        var i = 0, final_render = '', completed = 0;
                        // With each row returned we need to...
                        result.rows.forEach(function(row) {
                            renderListElement(i++, urlObj, template, listData, row.doc, function(err, rendered_list_element) {
                                final_render += rendered_list_element;
                                if(++completed == items.length) {
                                    cb(err, final_render);
                                }
                            });
                        });
                    }
                });
            } else {
                cb(null, listData.start + listData.end);
            }
        }
    });
}

// Render the {{element}} aspect of a list
function renderListElement(index, urlObj, view_template, listData, elementData, cb) {

    function replace(f, pageData, finish) {
        var matches = f.match(modelReplaces);
        if(matches) {
            // Replace the {{ .. }} with whatever it's supposed to be
            getData(urlObj, matches[0], pageData, function(err, val) {
                if(err) {
                    cb(err);
                } else {
                    f = f.replace(matches[0], val);
                    replace(f, pageData, finish);
                }
            });
        } else {
            finish(null, f);
        }
    }

    // Render the content through the specified template...
    replace(view_template, elementData, function(err, rendered_content) {
        // Then render that into the list element...

        // TODO: Here is where we will need to parse things like even, odd, classes, etc, probalby in a helper function
        cb(null, listData.element.replace('{{child}}', '<span class="edit_list_item" id="'+elementData._id+'">'+rendered_content+'</span>'));
    });
}

function parseListView(view, cb) {
    var f,
        data = {},
        elems = ['start', 'end', 'element'],
        l = elems.length;
    try {
        f = fs.readFileSync('templates/'+view).toString();
    } catch(e) {
        cb('Error parsing list `'+view+': ',e);
    }
    while(l--) {
        var r = new RegExp('\\{\\{\\s*'+elems[l]+'\\s*\\}\\}\\s*(\\S+)\\s*\\{\\{\\s*/\\s*'+elems[l]+'\\s*\\}\\}'),
            match = f.match(r);
        if(!match) {
            cb('Required field `'+elems[l]+'` not found in list view `'+view+'`');
            break;
        }
        data[elems[l]] = match[1];
    }
    cb(null, data);
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
            list: fields[1] == 'list' ? true : false
        };

    //TODO: better way to identify {{template.html}} import
    if(split[1] == 'html') {
        conclusion.include = true;
    } else {
        // Say if this has an attribute like {{child.attr}}
        conclusion.attr = split[1] || null;

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

function getOrCreate(path, template, cb) {
	couch.getDoc(path, function(err, firstres) {
		if(err) {
			// This thing is not yet in the database. Let's put it there!
			var new_obj = {template: template};
			// TODO: Here we create the db entry even if the template file does not exist.
			// We should check for it and error up there if it doesn't exist
			couch.saveDoc(path, new_obj, function(err, added) {
                new_obj._id = added.id;
                new_obj.rev = added.rev;
				cb(err, new_obj);
			});
		} else {
			cb(null, firstres);
		}
	});
}
