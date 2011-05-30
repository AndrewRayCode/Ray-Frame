var templater = module.exports,
    log = require('simple-logger'),
    sys = require('sys'),
	fs = require('fs'),
	path = require('path'),
    transients = require('../transients'),
    flowControl = require('./flower'),
    utils = require('./utils'),
    parser = require('uglify-js').parser,
    uglifier = require('uglify-js').uglify,
    themes_dir = '../../user/themes/',
    template_links_dir = '/tmp/tlinks/',
    transientFunctions = '',
    prefixii,
    couch,
    theme;

// Regex to find {{ stuff }}
exports.modelReplaces = /\{\{\S+?\}\}/g;
exports.controlStatements = /\{% \S+? %\}/g;

// Set variables we need
exports.setReferences = function(db) {
    couch = db;
};

exports.cacheTheme = function(str, cb) {
    theme = str + '/';
    
    templater.listAllThemeTemplates(function(err, files) {
        if(err) {
            return cb(err);
        }
        var l = files.length,
            processed = 0,
            total = l;

        function process(filepath) {
            fs.readFile(filepath, function(err, contents) {
                //for(var x = 0; x < 
                templater.buildFinalTemplateString(contents.toString(), function(err, funcStr) {
                    templater.saveTemplateString(path.basename(filepath), funcStr);
                    if(++processed == total) {
                        cb();
                    }
                });
            });
        }
        while(l--) {
            process(files[l]);
        }
    });
};

exports.saveTemplateString = function(name, funcStr) {
    // builds: name(objOrIds, locals, cb) { ... funcStr ... }
    log.warn(funcStr);

    var ast;
    try {
        var ast = parser.parse(funcStr); // parse code and get the initial AST
    } catch(e) {
        throw new Error('Template function string could not be parsed, syntax error found by uglify-js. This is bad.');
    }
    ast = uglifier.ast_mangle(ast); // get a new AST with mangled names
    ast = uglifier.ast_squeeze(ast); // get an AST with compression optimizations

    return templater.templateCache[name] = new Function('cache', 'flowControl', 'objOrIds', 'locals', 'cb', uglifier.gen_code(ast));
};

exports.handlers = {
    textNode: {
        handler: function(raw, cb) {
            var output = '';

            if(this.state.indexOf('pre') == -1) {
                raw = raw.replace(/\r|\n/g, ' ').replace(/\s+/, ' ');
            }
            raw = raw.replace(/\\/g, '\\\\');

            for(var x = 0; x < raw.length; x++) {
                if(raw[x] == '"') {
                    output += '\\';
                }
                output += raw[x];
            }
            this.output += this.identifier + ' += "' + output + '";';
            cb();
        }
    },
    controls: {
        start: '{% ',
        end: ' %}',
        handlers: [{
            matcher: /^pre/,
            handler: function(raw, cb) {
                this.state.push('pre');
                cb();
            }
        }, {
            matcher: /\/pre^/,
            handler: function(raw, cb) {
                this.state.splice(this.state.indexOf('pre'), 1);
                cb();
            }
        }]
    },
    plips: {
        start: '{{',
        end: '}}',
        handlers: [{
            name: 'list',
            matcher: /:list/,
            handler: function(raw, cb) {
                cb();
            }
        },{
            name: 'plip',
            matcher: /.+/,
            handler: function(raw, cb) {
                var instructions = templater.getInstructions('{{'+raw+'}}');

                this.output += this.identifier + ' += (locals["'+instructions.field+'"] || pageData["'+instructions.field+'"]);';
                cb();
            }
        }]
    }
};

exports.parser = function() {
    this.state = [];
    this.identifier = 'str';
    this.parseData = {outdent: ''};
    this.starts = [];

    this.output = 'var '+this.identifier + ' = "";';

    for(var groupName in templater.handlers) {
        var group = templater.handlers[groupName];
        group.start && this.starts.push(group.start[0]);
    }

    this.parse = function(input, cb) {
        var html = '',
            me = this,
            flower = new flowControl(me);

        for(var x = 0, l = input.length; x < l; x++) {
            var character = input[x];
            html += character;

            if(~this.starts.indexOf(character)) {
                for(var groupName in templater.handlers) {
                    var group = templater.handlers[groupName];
                    if(group.start && input.substr(x, group.start.length) == group.start) {
                        // Scan ahead till we find the end
                        var end = input.indexOf(group.end, x + 1),
                            contents = input.substring(x + group.start.length, end);

                        if(!end) {
                            cb(new Error('Opening `'+group.start+'` found but no closing `'+group.end+'` found!'));
                        }
                        if(html.length) {
                            (function(html) {
                                flower.add(function() {
                                    templater.handlers.textNode.handler.call(me, html.slice(0,-1), flower.getNextFunction());
                                });
                            })(html);

                            html = '';
                        }

                        var handlers = group.handlers;
                        for(var i = 0, hl = handlers.length; i < hl; i++) {
                            var handler = handlers[i];
                            if(handler.matcher.test(contents)) {
                                (function(contents){
                                    flower.add(function() {
                                        handler.handler.call(this, contents, flower.getNextFunction());
                                    });
                                })(contents);
                                break;
                            }
                        }
                        x = end + group.end.length - 1;
                        break;
                    }
                }
            }
        }
        if(html.length) {
            flower.add(function() {
                templater.handlers.textNode.handler.call(me, html, flower.getNextFunction());
            });
        }

        flower.add(function() {
            me.output += me.parseData.outdent
                + 'cb(null, '+me.identifier+')';
            cb(null, me.output);
        }).onError(cb).execute();
    }
};

// Take the contents of a template and make an executable function for it. If we have any lists we need functions to get that list data,
// potentially recursing. Make a getdata function for each recursion and wrap it around the main output, with a way for that block to know
// what local data to use
exports.buildFinalTemplateString = function(template, role, cb) {
    // function(objOrIds, locals, cb) {...}

    var parser = new templater.parser();
    parser.parse(template, role, function(err, output) {
        cb(null, output);
    });

    var output = "var flower = new flowControl(this), str = '', pageData;",
        parseData = {
            getObjectsById: [],
            outdent: ''
        };
};

exports.buildTemplateString = function(template, parseData, cb) {
    var output = '',
        cuts = [],
        index;
    //we want to render a page like <div>{{title}}</div>
    //that becomes function(objOrIds, locals, cb) {templater.getObjects({id: objOrIds}, function(objs) { var str = '<div>' + objs[objOrIds].title + '</div>' }
    // get all plips
    // parse plips into javascript commands to execute (recurse)
    // replace html blocks with strings that are added to str
    function findCuts(cuts, template, regex, type, matches, index) {
        if((matches = template.match(regex)) && (index = -1)) {
            while(index++ < matches.length - 1) {
                cuts.push({start: template.indexOf(matches[index]), length: matches[index].length, type: type, src: matches[index]});
            }
        }
    }

    findCuts(cuts, template, templater.modelReplaces, 'plip');
    findCuts(cuts, template, templater.controlStatements, 'control');

    var combined = [],
        processed = 0;

    if(cuts.length) {
        var inBetweens = [],
            first = cuts[0],
            last = cuts[cuts.length - 1],
            lastEnd = last.start + last.length;
        // if our first plip doesn't start at 0, grab the first text node in the template
        if(first.start != 0) {
            inBetweens.push({start: 0, length: first.start - 1, type: 'text', src: template.substring(0, first.start)});
        }
        // if our last plip doesn't end at the last position, grab the last text node
        if(lastEnd != template.length - 1) {
            inBetweens.push({start: lastEnd + 1, length: template.length - lastEnd, type: 'text', src: template.substring(lastEnd)});
        }
        // Fill in the text nodes between each plip
        for(var cut, x = 1; cut = cuts[x++];) {
            var prev = cuts[x - 1],
                prevEnd = (prev.start + prev.length + 1);
            if(cut.start != prevEnd) {
                inBetweens.push({start: prevEnd, length: cut.start - prevEnd, type: 'text', src: template.substring(prevEnd, cut.start - prevEnd)});
            }
        }
        cuts = cuts.concat(inBetweens).sort(function(a, b) {
            return a.start > b.start;
        });

        function addToCombined(command, src, index) {
            command(src, parseData, function(err, result) {
                combined[index] = result;
                if(++processed == cuts.length) {
                    combineString();
                }
            });
        }

        for(var cut, x = 0; cut = cuts[x++];) {
            if(cut.type == 'text') {
                addToCombined(templater.buildTextNode, cut.src, x);
            } else if(cut.type == 'plip') {
                addToCombined(templater.buildInstructionsFromPlip, cut.src, x);
            } else {
                //TODO: Control statements
            }
        }
    } else {
        templater.buildTextNode(template, parseData, function(err, str) {
            combined.push(str);
            combineString();
        });
    }

    function combineString() {
        output += combined.join('');
        cb(null, output);
    }
};

exports.buildInstructionsFromPlip = function(plip, parseData, cb) {
    var instructions = templater.getInstructions(plip);
    if(instructions.include) {
        if(instructions.local) {
            //Function('cache', 'objOrIds', 'locals', 'cb');
            var output = "templater.templateCache['"+instructions.field+"'](cache, pageData, locals, function(err, rendered) {"
                + "output += rendered;";
            parseData.outdent += '})';
            cb(null, output);
        } else {
            var output = "templater.templateCache['"+instructions.field+"'](cache, "+instructions.field+", locals, function(err, rendered) {"
                + "output += rendered;";
            parseData.outdent += '})';
            cb(null, output);
        }
    } else if(instructions.list) {

    } else {
        cb(null, "str += (locals['"+instructions.field+"'] || pageData['"+instructions.field+"']);");
    }
};

exports.buildTextNode = function(str, parseData, cb) {
    cb(null, 'str += "'+str.replace(/"/g, '\\"').replace(/\n/g, '\\n')+'";');
};

exports.templateCache = {};

// Templates can be stored in any folder structure the user wants in themes/theme/templates. For faster
// template lookup, symlink all the template names to /tmp/tlinks so we can just know that "blog.html" lives
// at wherever it lives. One obvious issue is templates can't share names even in subfolders. TODO: Address that issue 
// but only if we need to. It may not be a problem, see how websites implement template names
//exports.updateSymLinks = function(cb) {
    //var linked = 0,
        //total = 0,
        //hasErrored = false,
        //totalFilesToDelete = 0;
        //filesDeleted = 0;
    //function linkFile(file) {
        //if(hasErrored) {
            //return;
        //}
        //var symlink_file = template_links_dir + path.basename(file);
        ////log.warn('symlinking ',file,' to ',symlink_file);
        //fs.symlink(file, symlink_file, function(err, sts) {
            //if(err && !hasErrored) {
                //hasErrored = true;
                //log.error('Error updating symlinks directory!: ',err);
                //cb(err);
            //} else if(!hasErrored){
                //if(++linked == total) {
                    //cb();
                //}
            //}
        //});
    //}
    //function startLinking() {
        //fs.mkdir(template_links_dir, 0777, function(err) {
            //if(err) {
                //return cb(err);
            //}
            //templater.listAllThemeTemplates(function(err, files) {
                //if(err) {
                    //return cb(err);
                //}
                //var l = files.length;
                //total = l;
                //while(l--) {
                    //linkFile(files[l]);
                //}
            //});
        //});
    //}
    //function killFile(file) {
        //fs.unlink(file, function(err) {
            //if(++filesDeleted == totalFilesToDelete) {
                //fs.rmdir(template_links_dir, function(sts) {
                    //startLinking();
                //});
            //}
        //});
    //}
    //fs.readdir(template_links_dir, function (err, files) {
        //if(err) {
            //// Hooray it doesn't exist!
            //startLinking();
        //} else if(!files.length) {
            //// It has no files so we can delete the bitch
            //fs.rmdir(template_links_dir, function(sts) {
                //startLinking();
            //});
        //} else {
            //// It has files and we have to manually delete them one by one THEN delete the directory
            //// because node.js does not appear to have the ability to do rm -r
            //totalFilesToDelete = files.length;
            //for(var x=0, l=files.length; x<l; x++) {
                //killFile(template_links_dir + files[x]);
            //}
        //}
    //});
//};

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
		if(fields[1] == 'local') {
			conclusion.local = true;
		}
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
            templater.getData(user, urlObj, matches[0], pageData, function(err, val) {
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
        cb(null, listData.element.replace('{{child}}', '<span class="edit_list_item" id="'+(elementData._id || elementData.id)+'">'+rendered_content+'</span>'));
    });
};

// Get the actual items from the database, returns an array. If newItem is specified, it will be added to the end
// of the returned array, which is kind of silly and I think TODO: this method should be refactored, or at least
// better named. Plus, wouldn't we want to add newItem to the BEGINNING of the list?
exports.getListItems = function(instructions, pageData, newItem, cb) {
    if(!cb) {
        cb = newItem;
        newItem = null;
    }
    function queryView(view, id) {
        // Call the view with ?key=parent_id to get all children
        couch.view('master', view, {key: id}, function(err, result) {
            if(err) {
                log.error('Error fetching list design document in couch: ',err);
                return cb(err);
            }
            var docs = [];
            for(var x=0, l=result.rows.length; x<l; x++) {
                docs.push(result.rows[x].value);
            }
            cb(null, docs);
        });
    }
    // Only user sorts cause documents to get an array of ids
    if(instructions.sort == 'user') {
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
            // We are not updating the parent's list with the new id here, we are just temporarly storing it to render the list. The new item
            // exists in the database without a title, but if the user cancels or leaves the page then we have more work to do. See saveListItem
            // for where this array of ids is actually updated. Is this a good idea? You tell me.
            cb(null, newItem ? [newItem] : []);
        }
    // For everything else a view is made
    } else {
        couch.getDesign('master', function(err, doc) {
            if(err) {
                log.error('There was a fatal error, master design not found!', err);
                return cb(err);
            }
            var view = templater.getViewName(instructions);
            if(!doc.views[view]) {
                if(instructions.type) {
                    doc.views[view] = {
                        map: utils.formatFunction(function(doc) {
                            if(doc.template) {
                                var views = $1;
                                for(var x=0; x<views.length; x++) {
                                    if(doc.template == views[x] + '.html') {
                                        emit(doc.parent_id, doc);
                                        break;
                                    }
                                }
                            }
                        }, instructions.type.split(','))
                    };
                } else {
                    doc.views[view] = {
                        map: function(doc) {
                            if(doc.template) {
                                emit(doc.parent_id, doc);
                            }
                        }
                    };
                }
                couch.saveDesign('master', doc, function(err) {
                    queryView(view, pageData._id);
                });
            } else {
                queryView(view, pageData._id);
            }
        });
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
exports.getData = function(user, urlObject, plip, pageData, cb) {
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
		// There are two types of includes. A global include like {{header.html}} means that all pages using this include will share the
		// same data, like navigation. A local include, like {{comments.html:local}} means that data will be relative to the current
		// page we are on. Something added to a local include's list won't be visible on another object using that include
		if(instructions.local) {
			// This is kind of sketchy. We need to render this include with the same data as the current page, so just replace
			// the template field of the current db object with the include's template and render it. Maybe recurseTemplateDir
			// should take template name
			pageData.template = instructions.field;
			templater.recurseTemplateData(user, urlObject, pageData, false, cb);
        // Global include, so any pages that include this file will show the same result
		} else {
			var lookup = 'includes'+instructions.field;
			utils.getOrCreate(couch, 'includes'+instructions.field, instructions.field, function(err, obj) {
				if(err) {
					return cb(err);
				}
				templater.recurseTemplateData(user, urlObject, obj, false, cb);
			});
		}
	} else if(user.isAdmin) {
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

// Recursively read all template files from the current theme //TODO: I feel like theme shouldn't be global
exports.listAllThemeTemplates = function(cb) {
    utils.readDir(__dirname + '/' + themes_dir + theme + 'templates/', function(err, data) {
        if(err) {
            return cb(err);
        }
        var templates = [], f;
        for(var x=0; x<data.files.length; x++) {
            f = data.files[x];
            // template must be .html files (not say .swp files which could be in that dir)
            if((/\.html$/).test(f)) {
                templates.push(f);
            }
        }
        cb(null, templates);
    });
};

exports.listTemplates = function(options, cb) {
    if(typeof options == 'function') {
        cb = options;
        options = {};
    }
    templater.listAllThemeTemplates(function(err, files) {
        var templates = [],
            killname = 'templates/',
            f;
        for(var x=0; x<files.length; x++) {
            // include everything (including say vim swap files) if specified
            f = files[x].substring(files[x].indexOf(killname) + 10);
            if(options.really_include_all || 
                // Otherwise, we only want html files...
                ((/\.html$/).test(f) && 
                // And exclude convention named files like global by default
                (options.include_all || (f != 'global.html')) && f != 'index.html')) {
                templates.push(f);
            }
        }
        cb(null, templates);
    });
};

exports.parseTemplate = function(user, urlObj, pageData, canHaveGlobal, cb) {
	templater.recurseTemplateData(user, urlObj, pageData, canHaveGlobal, function(err, parsed) {
		if(err) {
			cb(err);
		}
		if(user.isAdmin) {
			// Add admin files to front end, and pass variables about current ids for page context. TODO: This is shittacular on so many levels
			// TODO: Also, uglify some shit up in this bitch
			parsed = parsed.replace('</body>', function() {
					return adminFiles+
						'<script>var current_id="'+pageData._id+'", current_url_id="'+urlObj._id+'", access_urls='+JSON.stringify(prefixii)+';'+
						transientFunctions+'</script></body>';
			});
		} else {
			parsd = parsed.replace('</body>', function() {
				return transientFunctions+'</script></body>';
			});
		}
		parsed = parsed.replace(/<\/form>/g, function() {
			return '<input type="hidden" name="current_id" value="'+pageData._id+'"><input type="hidden" name="current_url_id" value="'+urlObj._id+'"></form>';
		});
		cb(null, parsed);
	});
};

// Put the template into compiled and return the parsed data
exports.recurseTemplateData = function(user, urlObj, pageData, canHaveGlobal, cb) {
    var f, child, globalData;
    // First read the template from the templates directory
    templater.readTemplate(pageData.template, function(err, f) {
        if(err) {
            return cb('Template not found for `'+sys.inspect(pageData)+'`: '+err.message);
        }

        // Append the admin files and save the compiled page
        function end(f) {
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
                        templater.getData(user, urlObj, matches[0].replace('child.', ''), pageData, function(err, val) {
                            // TODO: Man, you know what, I'd rather just throw this junk, this doesn't feel DRY
                            if(err) {
                                return cb(err);
                            }
                            f = f.replace(matches[0], val);
                            replaceGlobal(f);
                        });
                    // Otherwise this is where we put the child in the template
                    } else {
                        f = f.replace(matches[0], child);
                        replaceGlobal(f);
                    }
                } else {
                    // For a global file there won't be a URL object, so for generating links on that page
                    // just fake it as the home page, _id is all we need for now
					templater.getData(user, {_id: utils.sanitizeUrl('/')}, matches[0], globalData, function(err, val) {
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
                templater.getData(user, urlObj, matches[0], pageData, function(err, val) {
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
                                return cb('Error reading template: `'+globalData.template+'`: '+sys.inspect(err));
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
    return 'type='+(instructions.type || 'all');
};
