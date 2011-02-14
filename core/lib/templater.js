var templater = module.exports,
    log = require('./logger'),
    sys = require('sys'),
    template_dir = '../../user/templates/themes/',
    template_links_dir = '/tmp/tlinks/',
	fs = require('fs'),
	path = require('path'),
    transients = require('../transients'),
    utils = require('./utils'),
	couch_client = require('../../../node-couchdb/index.js').createClient(5984, 'localhost'),
    couch = couch_client.db('rayframe'),
	adminFiles = '<script src="/static/admin/jquery-1.5.min.js"></script><script src="/static/admin/admin_functions.js"></script><link rel="stylesheet" href="/static/admin/admin.css" />',
    transientFunctions = '',
    // TODO: oh god I am repeating myself from server.js, fix this shenanegins
    ACCESS_PREFIX = '/access',
    theme;

// Regex to find {{ stuff }}
exports.modelReplaces = /\{\{\S+?\}\}/g;

// Set variables we need
exports.setReferences = function(role) {
    isAdmin = role;
};

exports.setTheme = function(str, cb) {
    theme = str + '/';
    templater.updateSymLinks(function(err) {
        cb(err);
    });
};

// Templates can be stored in any folder structure the user wants in themes/theme/templates. For faster
// template lookup, symlink all the template names to /tmp/tlinks so we can just know that "blog.html" lives
// at wherever it lives. One obvious issue is templates can't share names even in subfolders. TODO: Address that issue 
// but only if we need to. It may not be a problem, see how websites implement template names
exports.updateSymLinks = function(cb) {
    var linked = 0,
        total = 0,
        hasErrored = false,
        totalFilesToDelete = 0;
        filesDeleted = 0;
    function linkFile(file) {
        if(hasErrored) {
            return;
        }
        var symlink_file = template_links_dir + path.basename(file);
        fs.symlink(file, symlink_file, function(err, sts) {
            if(err && !hasErrored) {
                hasErrored = true;
                log.error('Error updating symlinks directory!: ',err);
                cb(err);
            } else if(!hasErrored){
                if(++linked == total) {
                    cb();
                }
            }
        });
    }
    function startLinking() {
        fs.mkdir(template_links_dir, 0777, function(err) {
            if(err) {
                return cb(err);
            }
            templater.listAllThemeTemplates(function(err, files) {
                if(err) {
                    return cb(err);
                }
                var l = files.length;
                total = l;
                while(l--) {
                    linkFile(files[l]);
                }
            });
        });
    }
    function killFile(file) {
        fs.unlink(file, function(err) {
            if(++filesDeleted == totalFilesToDelete) {
                fs.rmdir(template_links_dir, function(sts) {
                    startLinking();
                });
            }
        });
    }
    fs.readdir(template_links_dir, function (err, files) {
        if(err) {
            // Hooray it doesn't exist!
            startLinking();
        } else if(!files.length) {
            // It has no files so we can delete the bitch
            fs.rmdir(template_links_dir, function(sts) {
                startLinking();
            });
        } else {
            // It has files and we have to manually delete them one by one THEN delete the directory
            // because node.js does not appear to have the ability to do rm -r
            totalFilesToDelete = files.length;
            for(var x=0, l=files.length; x<l; x++) {
                killFile(template_links_dir + files[x]);
            }
        }
    });
};

// toString all the functions that we want to access on the front end
exports.addTransientFunction = function() {
    var args = Array.prototype.slice.call(arguments), l = args.length, ref;
    while(l--) {
        try {
            // Either this is a string referencing a funciton like "utils.splort"
            if(typeof args[l] == 'string') {
                // Eval is evil! Is there a better way?
                ref = eval(args[l]);
            // or this is a ['functionname', function() {..actual function reference...}] array. We need both to output it to front end
            } else {
                ref = args[l][1];
                args[l] = 'a.'+args[l][0];
            }
        } catch(e) {
            log.error('Fatal error: Nonexistant reference `'+args[l].toString()+'` was added to transient variables. It will not be available on the front end.');
            continue;
        }
        // TODO: Transient functions should probably require role permissions, like admin gets this, public gets this. addPublicTransientFuncitons would be good,
        // because who cares what methods the logged in content editor gets, they can't use them without back end authentication
        transientFunctions += 'RayFrame.Transients["'+
            // Put all funcitons on the RayFrame.Transients objects. Replace 'module.fnName' to just 'fnName'. Collisions are possible, like utils.stuff()
            // will overwrite otherModule.stuff(), but I'm not worried right now
            args[l].replace(/.*\./, '')+'"] = '+
            // Ok, so there are a few problems with moving back end code to front end code, namely dependencies with require. Right now I'm just saying
            // you can only use functions in lib/utils.js in your transient functions. I don't want to have to resolving that bullshit.
            ref.toString().replace(/(\W)utils\./g, '$1RayFrame.Transients.')+';';
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
    var data = {},
        elems = ['start', 'end', 'element'],
        l = elems.length;
    templater.readTemplate(view, function(err, f) {
        if(err) {
            cb('Error parsing list `'+view+': '+sys.inspect(err));
            return;
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
    });
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

exports.getListItems = function(instructions, pageData, newItem, cb) {
    if(!cb) {
        cb = newItem;
        newItem = null;
    }
    function queryView() {
        couch.view('master', view, function(err, result) {
            if(err) {
                log.error('Error fetching list design document in couch: ',err);
                cb(err);
                return;
            }
            var docs = [];
            for(var x=0, l=result.rows.length; x<l; x++) {
                docs.push(result.rows[x].value);
            }
            // It looks like since we already have a stub in the db, re-adding it to the list makes it show up twice
            /*
            if(newItem) {
                docs.push(newItem);
            }
            */
            cb(null, docs);
        });
    }
    if(instructions.type) {
        var view = templater.getViewName(instructions);
        couch.getDesign('master', function(err, doc) {
            if(err) {
                log.error('There was a fatal error, master design not found!', err);
                cb(err);
                return;
            }
            if(!doc.views[view]) {
                doc.views[view] = {
                    map: utils.formatFunction(function(doc) {
                        if(doc.template) {
                            var views = $1;
                            for(var x=0; x<views.length; x++) {
                                if(doc.template.indexOf(views[x]) > -1) {
                                    emit(views[x], doc);
                                    break;
                                }
                            }
                        }
                    }, [sys.inspect(instructions.type.split(','))])
                };

                couch.saveDesign('master', doc, function(err) {
                    queryView();
                });
            } else {
                queryView();
            }
        });
    } else {
        var field = pageData[instructions.field];

        if(field && field.length) {
            couch.getDocsByKey(field, function(err, result) {
                if(err) {
                    cb(err);
                    return;
                }
                var docs = [];
                for(var x=0, l=result.rows.length; x<l; x++) {
                    docs.push(result.rows[x].doc);
                }
                if(newItem) {
                    docs.push(newItem);
                }
                cb(null, docs);
            });
        } else {
            // We are note updating the parent's list with the new id here, we are just temporarly storing it to render the list. The new item
            // exists in the database without a title, but if the user cancels or leaves the page then we have more work to do. See saveListItem
            // for where this array of ids is actually updated. Is this a good idea? You tell me.
            cb(null, newItem ? [newItem] : []);
        }
    }
};

exports.renderList = function(items, instructions, urlObj, pageData, cb) {
    templater.parseListView(instructions.list_view || 'list.html', function(err, listData) {
        if(err) {
            cb('Error parsing list view: '+err);
            return;
        }
        var template_view = instructions.view || 'link.html';

        // If this is a list the user can manually add to
        if(items && items.length > 0) {
            templater.readTemplate(template_view, function(err, template) {
                if(err) {
                    cb('Error reading link template `'+template_view+'`: '+err);
                    return;
                }
                var i = 0, final_render = '', completed = 0;
                items.forEach(function(item) {
                    templater.renderListElement(i++, urlObj, template, listData, item, function(err, rendered_list_element) {
                        final_render += rendered_list_element;
                        if(++completed == items.length) {
                            cb(err, listData.start + final_render + listData.end);
                        }
                    });
                });
            });
        } else {
            cb(null, listData.start + listData.end);
        }
    });
};

// Get the data from an object and replace it into its proper plip, like {{ }}. Also handles includes
exports.getData = function(urlObject, plip, pageData, cb) {
	var instructions = templater.getInstructions(plip),
        val = pageData[instructions.field] || '';

    // If we have a render function apply it to the value
    if(instructions.renderFunc) {
        val = transients[instructions.renderFunc](val);
    }

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
        var edit_id = (pageData._id || pageData.id)+':'+instructions.raw,
            callback = function(err, val) {
                cb(err, '<span class="edit_list" id="'+edit_id+'">'+val+'</span>');
            };
		if(instructions.list) {
            templater.getListItems(instructions, pageData, function(err, items) {
                if(err) {
                    cb(err);
                    return;
                }
                templater.renderList(items, instructions, urlObject, pageData, callback);
            });
		} else if(!instructions.noEdit) {
			cb(null, '<span class="edit_me" id="'+edit_id+'">'+val+'</span>');
		} else {
			cb(null, val);
		}
	} else {
		cb(null, val);
	}
};

exports.readTemplate = function(name, cb) {
    name = name.substr(-5) == '.html' ? name : name + '.html';
    // We need to include dirname because if templater is called from somewhere other than core/lib, the relative
    // path changes. I don't think I like this
    var tmpl = template_links_dir + name;
    fs.readFile(tmpl, function(err, file) {
        if(err) {
            // If this file isn't found, maybe the template directory was updated and that template
            // got moved or renamed. Rebuild the symlink directory then try to find it again. If it 
            // still doesn't exist, then it really doesn't exit
            // TODO: Look into fs.watchFile, see if we can watch the templates directory (not individual html files)
            //       for changes so that we can rerun updateSymLinks for more robust lookups
            templater.updateSymLinks(function(err) {
                fs.readFile(tmpl, function(err, file) {
                    if(err) {
                        return cb(err);
                    }
                    return cb(null, file.toString());
                });
            });
        } else {
            cb(null, file.toString());
        }
    });
};

exports.listAllThemeTemplates = function(cb) {
    if(typeof options == 'function') {
        cb = options;
        options = {};
    }
    utils.readDir(__dirname + '/' + template_dir + theme, function(err, data) {
        if(err) {
            return cb(err);
        }
        var templates = [], f;
        // Filter out VIM swap files for example
        for(var x=0; x<data.files.length; x++) {
            f = data.files[x];
            // template must be .html files (not say .swp files which could be in that dir)
            if((/\.html$/).test(f)) {
                templates.push(f);
            }
        }
        cb(null, templates);
    });
}

exports.listTemplates = function(options, cb) {
    var templates = [], f;
    // Filter out VIM swap files for example
    for(var x=0; x<files.length; x++) {
        // include everything (including say vim swap files) if specified
        f = path.basename(files[x]);
        if(options.really_include_all || 
            // Otherwise, we only want html files...
            ((/\.html$/).test(f) && 
            // And exclude convention named files like global by default
            (options.include_all || (f != 'global.html')) && f != 'index.html')) {
            templates.push(f);
        }
    }
    cb(null, templates);
};

// Put the template into compiled and return the parsed data
exports.parseTemplate = function(urlObj, pageData, canHaveGlobal, cb) {
    var f, child, globalData;
    // First read the template from the templates directory
    templater.readTemplate(pageData.template, function(err, f) {
        if(err) {
            cb('Template not found for `'+sys.inspect(pageData)+'`: '+err.message);
            return;
        }

        // Append the admin files and save the compiled page
        function end(f) {
            if(isAdmin) {
                // Add admin files to front end, and pass variables about current ids for page context. TODO: This is shittacular on so many levels
                // TODO: Also, uglify some shit up in this bitch
                f = f.replace('</body>', (adminFiles+
                        '<script>var current_id="'+pageData._id+'", current_url_id="'+urlObj._id+'", access_url="'+ACCESS_PREFIX+'";'+
                        transientFunctions+'</script></body>').
                    // If you do:
                    // 'abc'.replace('c', "$'")
                    // $' evaluates to some regex capture group it looks like, even though 'c' isn't a regex
                    replace(/\$'/g, '$you-silly-capture-group')).replace(/you-silly-capture-group/g, "'");
            }
            fs.writeFile('compiled/'+urlObj._id, f);
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
                    // For a global file there won't be a URL object, so for generating links on that page
                    // just fake it as the home page, _id is all we need for now
                    templater.getData({_id:'~'}, matches[0], globalData, function(err, val) {
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
                        templater.readTemplate(globalData.template, function(err, g) {
                            if(err) {
                                cb('Error reading template: `'+globalData.template+'`: '+sys.inspect(err));
                                return;
                            }
                            replaceGlobal(g);
                        });
                    } else {
                        end(f);
                    }
                });
            } else {
                end(f);
            }
        }
        replace(f);
    });
};

exports.getViewName = function(instructions) {
    return 'type='+instructions.type;
};
