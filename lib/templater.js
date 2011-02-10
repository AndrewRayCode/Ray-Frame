var templater = module.exports,
    log = require('./logger'),
    sys = require('sys'),
    template_dir = 'templates/',
	fs = require('fs'),
    utils = require('./utils'),
	couch_client = require('../../node-couchdb/index.js').createClient(5984, 'localhost'),
    couch = couch_client.db('rayframe'),
	adminFiles = '<script src="/static/admin/jquery-1.5.min.js"></script><script src="/static/admin/admin_functions.js"></script><link rel="stylesheet" href="/static/admin/admin.css" />',
    transientFunctions = '',
    // TODO: oh god I am repeating myself from server.js, fix this shenanegins
    ACCESS_PREFIX = '/access';

// Regex to find {{ stuff }}
exports.modelReplaces = /\{\{\S+?\}\}/g;

exports.setReferences = function(role) {
    isAdmin = role;
};

exports.addTransientFunction = function() {
    var args = Array.prototype.slice.call(arguments), l = args.length, ref;
    while(l--) {
        // Eval is evil! Is there a better way?
        try {
            ref = eval(args[l]);
        } catch(e) {
            log.error('Fatal error: Nonexistant reference `'+args[l].toString()+'` was added to transient variables. It will not be available on the front end.');
            continue;
        }
        transientFunctions += 'RayFrame.Transients["'+args[l].replace(/.*\./, '')+'"] = '+ref.toString()+';';
    }
};

// Parse a "plip" which is anything in {{ }} on a template
exports.getInstructions = function(plip) {
    var raw, doc_id;
    if(plip.substring(0,2) == '{{') {
        // This plip came from a template file
        plip = plip.substring(2, plip.length-2);
    } else {
        // This plip came from the front end, and it will be docid:plip without the {{ }}
        raw = plip;

        doc_id = plip.substring(0, plip.indexOf(':'));
        // Parse out the plip minus the doc_id for getting instructions
        plip = plip.replace(doc_id+':', '');
    }
    var fields = plip.split(':'),
        l = fields.length,
        split = fields[0].split('.'),
        conclusion = {
            field: fields[0],
            raw: raw || plip,
            noEdit: fields.indexOf('noEdit') > -1 ? true : false,
            list: fields[1] == 'list' ? true : false,
            doc_id: doc_id
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
};

exports.parseListView = function(view, cb) {
    var f,
        data = {},
        elems = ['start', 'end', 'element'],
        l = elems.length;
    try {
        f = fs.readFileSync(template_dir+view).toString();
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
};

// Render the {{element}} aspect of a list
exports.renderListElement = function(index, urlObj, view_template, listData, elementData, cb) {

    function replace(f, pageData, finish) {
        var matches = f.match(templater.modelReplaces);
        if(matches) {
            // Replace the {{ .. }} with whatever it's supposed to be
            templater.getData(urlObj, matches[0], pageData, function(err, val) {
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
};

exports.renderList = function(instructions, urlObj, pageData, cb) {
    templater.parseListView(instructions.list_view || 'list.html', function(err, listData) {
        if(err) {
            cb('Error parsing list view: ',err);
        } else {
            var items = pageData[instructions.field],
                template_view = instructions.list_view || 'link.html';
            
            try {
                template = fs.readFileSync(template_dir+template_view).toString();
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
                            templater.renderListElement(i++, urlObj, template, listData, row.doc, function(err, rendered_list_element) {
                                final_render += rendered_list_element;
                                if(++completed == items.length) {
                                    cb(err, listData.start + final_render + listData.end);
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
};

// Get the data from an object and replace it into its proper plip, like {{ }}. Also handles includes
exports.getData = function(urlObject, plip, pageData, cb) {
	var instructions = templater.getInstructions(plip);
		val = pageData[instructions.field] || '';

    // URL is a special magical case, it should become the URL of the item
    if(instructions.field == 'url') {
        cb(null, utils.newUrlFromId(urlObject._id, pageData.title));
	// If this is an included file we need to start the parse chain all over again
    } else if(instructions.include) {
		var lookup = 'includes'+instructions.field;
		utils.getOrCreate(lookup, instructions.field, function(err, obj) {
			if(err) {
				cb(err);
			} else {
                templater.parseTemplate(urlObject, obj, false, cb);
			}
		});
	} else if(isAdmin) {
        var edit_id = pageData._id+':'+instructions.raw,
            callback = function(err, val) {
                cb(err, '<span class="edit_list" id="'+edit_id+'">'+val+'</span>');
            };
		if(instructions.list) {
            templater.renderList(instructions, urlObject, pageData, callback);
		} else if(!instructions.noEdit) {
			cb(null, '<span class="edit_me" id="'+edit_id+'">'+val+'</span>');
		} else {
			cb(null, val);
		}
	} else {
		cb(null, val);
	}
};

// Put the template into compiled and return the parsed data
exports.parseTemplate = function(urlObj, pageData, canHaveGlobal, cb) {
    var f, child, globalData;
    // First read the template from the templates directory
	try {
		f = fs.readFileSync(template_dir+pageData.template).toString();
	} catch(e) {
        cb('Template not found for `'+sys.inspect(pageData)+'`: '+e.message);
		return;
	}

    // Append the admin files and save the compiled page
    function end(f) {
        if(isAdmin) {
            // Add admin files to front end, and pass variables about current ids for page context. TODO: This is shittacular on so many levels
            // TODO: Also, uglify some shit up in this bitch
            f = f.replace('</body>', adminFiles+'<script>var current_id="'+pageData._id+'", current_url_id="'+urlObj._id+'", access_url="'+ACCESS_PREFIX+'";'+transientFunctions+'</script></body>');
        }
        fs.writeFileSync('compiled/'+urlObj._id, f);
        cb(null, f);
    }
    // Function to handle a global object if we have one (think template with header, footer, etc)
    function replaceGlobal(f) {
        var matches = f.match(templater.modelReplaces);
        if(matches) {
            // Find out what we are trying to insert
            var instr = templater.getInstructions(matches[0]);
            // Use special child directive to reference object this global wraps
            if(instr.field == 'child') {
                // If it has an attribute like child.title
                if(instr.attr) {
                    templater.getData(urlObj, matches[0].replace('child.', ''), pageData, function(err, val) {
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
                templater.getData(urlObj, matches[0], globalData, function(err, val) {
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
		var matches = f.match(templater.modelReplaces);
		if(matches) {
            // Replace the {{ .. }} with whatever it's supposed to be
			templater.getData(urlObj, matches[0], pageData, function(err, val) {
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
                    var g = fs.readFileSync(template_dir+globalData.template).toString();
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
};
