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
    themes_dir = '../../user/themes/';

// Regex to find {{ stuff }}
exports.modelReplaces = /\{\{\S+?\}\}/g;
exports.controlStatements = /\{% \S+? %\}/g;

// Set variables we need
exports.setReferences = function(db) {
    templater.couch = db;
};

exports.cacheTheme = function(theme, permissions, cb) {
    templater.templateCache = {};
    templater.rawCache = {};

    templater.theme = theme;
    
    // No real reason to do this more than once after a theme is set
    templater.templateDir = templater.getTemplateDir();

    templater.permissions = permissions;

    templater.listAllThemeTemplates(function(err, files) {
        if(err) {
            return cb(err);
        }
        var l = files.length,
            processed = 0,
            total = l;

        function process(filepath) {
            for(var x = 0, permission; permission = permissions[x++];) {
                templater.cacheTemplate(filepath, {permission: permission}, function(err) {
                    if(err || (++processed == total)) {
                        cb(err);
                    }
                });
            }
        }
        while(l--) {
            process(files[l]);
        }
    });
};

// Experimental!
exports.autoRevalidate = function() {
    fs.watchFile(templater.templateDir, function() {
        templater.cacheTheme(templater.theme, templater.permissions, function() {
            log.info('Cached theme `' + templater.theme + '`');
        });
    });
}

exports.cacheTemplate = function(filepath, options, cb) {
    var baseName = path.basename(filepath),
        cachedName = baseName + (options.permission ? options.permission.name : '');

    // Was this template (like an include wrapper) already parsed?
    if(cachedName in templater.templateCache) {
        return cb();
    }

    templater.getTemplateSource(baseName, function(err, contents) {
        templater.processTemplateString(contents, options, function(err, data) {
            if(err) {
                return cb(err);
            }

            //log.error(cachedName);
            //if(cachedName == 'index.htmladmin') {
                //var p = data.funcString.split(';');
                //for(var x=0; x < p.length; x++){
                    //log.error(p[x]+';');
                //}
            //}

            // Save the funciton string in our cache
            templater.templateCache[cachedName] = templater.mangleToFunction(data.funcString);

            // Also save the raw data in case we need to do anything else tricky with this template, like
            // use it as a wrapper
            cb(null, templater.rawCache[cachedName] = data.parseData);
        });
    });
};

exports.mangleToFunction = function(funcStr) {
    var ast;
    try {
        var ast = parser.parse(funcStr); // parse code and get the initial AST
    } catch(e) {
        throw new Error('Template function string could not be parsed, syntax error found by uglify-js. This is bad.');
    }
    ast = uglifier.ast_mangle(ast); // get a new AST with mangled names
    ast = uglifier.ast_squeeze(ast); // get an AST with compression optimizations

    return new Function('cache', 'templater', 'pageId', 'data', 'cb', uglifier.gen_code(ast));
};

// Template tag handlers. At some point this needs to be moved to its own file, or something, and users need to be able
// to define their own template handlers.
exports.handlers = {
    textNode: {
        handler: function(raw, cb) {
            var output = '';

            if(this.state.indexOf('pre') == -1) {
                raw = raw.replace(/\r|\n/g, ' ').replace(/\s+/g, ' ');
            }
            raw = raw.replace(/\\/g, '\\\\');

            for(var x = 0; x < raw.length; x++) {
                if(raw[x] == '"') {
                    output += '\\';
                }
                output += raw[x];
            }
            this.append('"' + output + '"');
            cb();
        }
    },
    controls: {
        start: '{% ',
        end: ' %}',
        // Put more specific handlers first!
        handlers: [{
            matcher: /^pre/,
            handler: function(raw, cb) {
                this.pushState('tagstate:pre');
                cb();
            }
        }, {
            matcher: /\/pre^/,
            handler: function(raw, cb) {
                this.popState('tagstate:pre', cb);
            }
        /*
        * List control handlers
        */
        }, {
            name: 'list start open',
            matcher: /^start$/,
            handler: function(raw, cb) {
                this.swapBuffer('start');
                cb();
            }
        }, {
            name: 'list start close',
            matcher: /^\/start$/,
            handler: function(raw, cb) {
                this.revertBuffer();
                cb();
            }
        }, {
            name: 'list end open',
            matcher: /^end$/,
            handler: function(raw, cb) {
                this.swapBuffer('end');
                cb();
            }
        }, {
            name: 'list start close',
            matcher: /^\/end$/,
            handler: function(raw, cb) {
                this.revertBuffer();
                cb();
            }
        }, {
            name: 'list item open',
            matcher: /^element$/,
            handler: function(raw, cb) {
                this.swapBuffer('element');
                cb();
            }
        }, {
            name: 'list item close',
            matcher: /^\/element$/,
            handler: function(raw, cb) {
                this.revertBuffer();
                cb();
            }
        // for pages with wrapping data
        }, {
            name: 'wrapped',
            matcher: /wrapped by .*\.html/,
            handler: function(raw, cb) {
                var instructions = templater.getInstructions(raw.replace('wrapped by ','')),
                    cachedWrap = templater.rawCache[instructions.field + this.role.name],
                    me = this;

                function handle(wrapper) {
                    var parts = wrapper.buffers.output.split('this.replacechild;');

                    for(var cacheItem in wrapper.itemsToCache) {
                        me.parseData.itemsToCache[cacheItem] = wrapper.itemsToCache[cacheItem];
                    }

                    me.parseData.declarations += wrapper.declarations;

                    // Add the wrapper to the cache list
                    me.parseData.itemsToCache[instructions.field] = false;

                    me.parseData.beforeTemplate = 
                            // TODO: Should this go at end or beginning? Matters for nesting includes
                        wrapper.beforeTemplate + 
                            // Set up child reference
                        'data["'+instructions.field+'"].child = pageId;'
                            // Set up parent reference
                        + 'data[pageId].parent = "'+instructions.field+'";'
                            // Swap pageIds so we start in wrapper
                        + 'pageId = "'+instructions.field+'";'
                            // Add in output from wrapper before {{child}}
                        + parts[0]
                            // Swap back to our {{child}} id to render child contents. Child template begins after this
                        + 'pageId = data[pageId].child;'
                            // Put back our beforetemplate stuff
                        + me.parseData.beforeTemplate;

                    me.parseData.afterTemplate = 
                            // Reset pageId to global because that puts us back in the scope
                        'pageId = "'+instructions.field+'";'
                            // Add in output from wrapper after {{child}}
                        + parts[1]
                            // Add in closing global braces
                        + me.parseData.afterTemplate
                            // Put back our closing braces
                        + wrapper.afterTemplate;

                    me.state.splice(me.state.indexOf('varstate:wrap'), 1);
                    cb();
                }
                if(cachedWrap) {
                    handle(cachedWrap);
                } else {
                    templater.cacheTemplate(instructions.field, {
                        permission: this.role,
                        // TODO: Are we creating an issue here depending on who renders the list? If wrapper is caught
                        // by templater first it won't be parsed with varstate:wrap... this might be frugal
                        preState: this.state.concat('varstate:wrap')
                    }, function(err, cacheData) {
                        if(err) {
                            return cb(err);
                        }

                        handle(cacheData);
                    });
                }
            }
        }, {
            name: 'include',
            matcher: /include .*\.html/,
            handler: function(raw, cb) {
                var instructions = templater.getInstructions(raw.replace('include ',''));

                this.parseData.itemsToCache[instructions.field] = false;

                // function('cache', 'templater', 'pageId', 'data', 'cb');
                this.appendRaw(
                    'data["'+instructions.field+'"].parent = pageId;'
                    + 'templater.templateCache["'+instructions.field + this.role.name+'"](cache, templater, "'+instructions.field+'", data, function(err, parsed) {'
                    + this.identifier + ' += parsed;');

                this.parseData.afterTemplate += '});';

                cb();
            }
        }]
    },
    plips: {
        start: '{{',
        end: '}}',
        // Put more specific handlers first!
        handlers: [{
            /*
             * List data handlers
             */
            name: 'list',
            matcher: /:list/,
            handler: function(raw, cb) {
                var instructions = templater.getInstructions(raw),
                    listTemplate = (instructions.listBody || 'list') + '.html',
                    cachedListCheck = templater.rawCache[listTemplate + this.role.name],
                    me = this;

                var handle = function(err, cachedList) {
                    if(err) {
                        return cb(err);
                    }
                    if(me.parseData.declarations.indexOf('function renderList(') < 0) {
                        me.parseData.declarations +=
                            'function renderList(listIds, listTemplateName, cb) {'
                                + 'var total = listIds.length,'
                                + '    processed = 0,'
                                + '    finished = [];'
                                + 'data.listData = {total: total};'
                                + 'for(var x = 0, l = listIds.length; x < l; x++) {'
                                    + '(function(index) {'
                                        + 'data.listData.index = index;'
                                        + 'data.listData.first = index === 0;'
                                        + 'data.listData.last = index == total;'
                                        // function('cache', 'templater', 'pageId', 'data', 'cb');
                                        +'templater.templateCache[listTemplateName](cache, templater, listIds[index], data, function(err, parsed) {'
                                            + 'finished[index] = {str: parsed, id: listIds[index]};'
                                            + 'if(++processed == total) {'
                                                + 'cb(null, finished);'
                                            + '}'
                                        + '})'
                                    + '})(x);'
                                + '}'
                            + '};';
                    }

                    var pieces = cachedList.buffers.element.split('this.replacechild;');

                    // nasty looking stuff. builds code that outputs list items
                    me.appendRaw('renderList(data[pageId].variables["' + instructions.field + '"], "'
                                + (instructions.view || 'link.html') + me.role.name
                                + '", function(err, renderedItems) {');

                    // surrounding edit for li
                    me.startEdit('pageId', instructions.raw);
                    me.appendRaw(cachedList.buffers.start + 'for(var x = 0, listItem; listItem = renderedItems[x++];) {');

                    // surrounding edit for list item
                    me.startEdit('"' + instructions.field + ':" + (listItem.id) + ":" + (x - 1)');
                    me.appendRaw(pieces[0]);
                    me.append('listItem.str');
                    me.endEdit();

                    me.appendRaw(';'+pieces[1] + '}');
                    me.appendRaw(cachedList.buffers.end);
                    me.endEdit();

                    me.parseData.afterTemplate += '});';
                    cb();
                }
                
                // Create view if needed
                templater.createViewIfNull(instructions, function(err, viewName) {
                    if(err) {
                        return cb(err);
                    }
                    me.parseData.itemsToCache[viewName] = {
                        field: instructions.field,
                        list: true
                    };

                    if(cachedListCheck) {
                        handle(null, cachedListCheck);
                    } else {
                        templater.cacheTemplate(listTemplate, {
                            permission: this.role
                        }, handle);
                    }
                });
            }
        },{
            name: 'list index',
            matcher: /^index$/,
            handler: function(raw, cb) {
                // Placeholder to replace, otherwise becomes empty statement
                this.append('data.listData.index');
                cb();
            }
        /*
         * Special case handlers
         */
        },{
            name: 'child',
            matcher: /^child$/,
            handler: function(raw, cb) {
                // Placeholder to replace, otherwise becomes empty statement
                this.appendRaw('this.replace'+raw+';');
                cb();
            }
        },{
            name: 'child.',
            matcher: /child\./,
            handler: function(raw, cb) {
                var instructions = templater.getInstructions(raw);

                if(!instructions.noEdit) {
                    this.startEdit('data[pageId].child', instructions.attr);
                }
                this.append(templater.whatDoesItMean(this.state, instructions.field));
                this.endEdit();
                cb();
            }
        },{
            name: 'parent',
            matcher: /parent\./,
            handler: function(raw, cb) {
                var instructions = templater.getInstructions(raw);

                if(!instructions.noEdit) {
                    this.startEdit('data[pageId].parent', instructions.attr);
                }
                this.append(templater.whatDoesItMean(this.state, instructions.field));
                this.endEdit();
                cb();
            }
        }, {
            name: 'url',
            matcher: /^url$/,
            handler: function(raw, cb) {
                // just so edit isn't applied
                this.append('data[pageId].variables.url');
                cb();
            }
        }, {
            name: 'plip',
            matcher: /.+/,
            handler: function(raw, cb) {
                var instructions = templater.getInstructions(raw);

                if(!instructions.noEdit) {
                    this.startEdit('pageId', instructions.field);
                }
                this.append('(data[pageId].locals["'+instructions.field+'"] || data[pageId].variables["'+instructions.field+'"] || "")');
                this.endEdit();
                cb();
            }
        }]
    }
};

exports.whatDoesItMean = function(stack, str) {
    var parts = str.split('.');
    switch(parts[0]) {
        case 'parent': 
            return 'data[data[pageId].parent].variables["'+parts[1]+'"]';
        case 'child':
            return 'data[data[pageId].child].variables["'+parts[1]+'"]';
        break;
    }
}

// Parser (really it's just a scanner, parsers are beyond me currently) that turns a template from the filesystem into an
// executable javascript function
exports.parser = function(options) {
    for(var option in options) {
        this[option] = options[option];
    }

    this.state = this.state || [];
    this.parseData = {
        beforeTemplate: '',
        declarations: '',
        afterTemplate: '',
        itemsToCache: {}
    };
    this.starts = [];
    this.buffers = {};
    this.bufferStack = [];

    // Cache all of the starting tags, like `{%` and `{{` to look for when scanning
    for(var groupName in templater.handlers) {
        var group = templater.handlers[groupName];
        group.start && this.starts.push(group.start[0]);
    }

    // The parser can deal with different 'buffers' (strings) to manage output, like we need to manage a buffer
    // for each part of a list template
    this.swapBuffer = function(buff) {
        this.outputBuffer = buff;
        this.bufferStack.push(buff);

        if(this.buffers[buff] === undefined) {
            this.buffers[buff] = '';
        }
    };

    // Remove the buffer state. If we are adding to the 'list' buffer, revert to the buffer we were previously adding to
    this.revertBuffer = function() {
        this.bufferStack.pop();
        this.outputBuffer = this.bufferStack[this.bufferStack.length - 1];
    };

    // Append straight code to the template
    this.appendRaw = function(str) {
        this.append(str, true);
    };

    // Append code to the output string eventually shown to the user
    this.append = function(str, exact) {
        this.buffers[this.outputBuffer] += (exact ? str : this.identifier + ' += ' + str + ';');
    };

    this.endEdits = [];

    this.startEdit = function(id, attr) {
        if(this.role.wrapTemplateFields) {
            this.buffers[this.outputBuffer] += this.identifier
                + ' += "<q id=\\"" + ' + id + (attr ? ' + "@' + attr + '"' : '') + ' + "\\" class=\\"rayframe-edit\\">";';
            this.endEdits.push('</q>');
        }
    }

    this.endEdit = function() {
        if(this.role.wrapTemplateFields && this.endEdits.length) {
            this.buffers[this.outputBuffer] += this.identifier + ' += "' + this.endEdits.pop() + '";';
        }
    }

    this.pushState = function(state) {
        this.state.push(state);
    };

    this.popState = function(state, cb) {
        var last = state[state.length - 1];
        if(state && state != last) {
            return cb(new Error('Tag mismatch found, found ',state,' but exepcted ',state)); 
        }
        this.state.pop();
        cb();
    }

    this.parse = function(input, cb) {
        this.swapBuffer('output');

        var html = '',
            me = this,
            flower = new flowControl(me);

        for(var x = 0, l = input.length; x < l; x++) {
            var character = input[x];
            // the html variable is used to track blocks of plain old html text
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
                                (function(contents, handler){
                                    flower.add(function() {
                                        handler.handler.call(this, contents, flower.getNextFunction());
                                    });
                                })(contents, handler);
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
            cb(null, me.parseData, me.buffers);
        }).onError(cb).execute();
    }
};

// Take raw template string from the filesystem and feed it to the parser. Store the parser's output in a meaningful way
// so that the data can be used in other areas
exports.processTemplateString = function(template, options, cb) {
    var parseOptions = {
        identifier: 'str',
        role: options.permission
    }
    if(options.preState) {
        parseOptions.state = options.preState;
    }

    var parser = new templater.parser(parseOptions);

    parser.parse(template, function(err, parseData, buffers) {
        if(err) {
            return cb(err);
        }

        // function('cache', 'templater', 'pageId', 'data', 'cb');

        var processedOutput = 
            'var ' + parser.identifier + ' = "",'
            + 'found = ' + sys.inspect(parseData.itemsToCache) + ';'
            + parseData.declarations
            + 'cache.fillIn(data, found, pageId, function(err) {'
                + parseData.beforeTemplate
                + buffers.output
                + parseData.afterTemplate
                + 'cb(null, ' + parser.identifier + ');'
            + '});';
        cb(null, {
            funcString: processedOutput,
            // Store our raw data in case something else needs to tear it apart
            parseData: {
                beforeTemplate: parseData.beforeTemplate,
                afterTemplate: parseData.afterTemplate,
                itemsToCache: parseData.itemsToCache,
                declarations: parseData.declarations,
                identifier: parser.identifier,
                buffers: buffers
            }
        });
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
        templater.transientFunctions += 'RayFrame.Transients["'+
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
        //// This plip came from the front end, and it will be docid:plip without the {{ }}
        //raw = plip;

        //doc_id = plip.substring(0, plip.indexOf(':'));
        //// Parse out the plip minus the doc_id for getting instructions
        //plip = plip.replace(doc_id+':', '');
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

    // Say if this has an attribute like {{child.attr}}
    conclusion.attr = split[1] || null;

    // If this isn't an include it could have things like `view=a.html` or `type=blog`
    while(l--) {
        var s = fields[l].split('=');
        if(s.length > 1) {
            conclusion[s[0]] = s[1];
        }
    }

    return conclusion;
};

// Recursively read all template files from the current theme //TODO: I feel like theme shouldn't be global
exports.listAllThemeTemplates = function(cb) {
    // Save locations in cache
    if(templater.templatePaths) {
        return cb(null, templater.templatePaths);
    }
    utils.readDir(templater.templateDir, function(err, data) {
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
        templater.templatePaths = templates;
        cb(null, templates);
    });
};

exports.getTemplateSource = function(name, cb) {
    templater.listTemplates({include_all: true}, function(err, templates) {
        for(var x = 0, template; template = templates[x++];) {
            if(path.basename(template) == name) {
                fs.readFile(templater.templateDir + template, function(err, contents) {
                    cb(null, contents.toString());
                });
                break;
            }
        }
    });
}

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
            // include non html files?
            if(options.really_include_all || (/\.html$/).test(f)) {
                templates.push(f);
            }
        }
        cb(null, templates);
    });
};

exports.getTemplateDir = function() {
    return __dirname + '/' + themes_dir + templater.theme + '/templates/';
};

exports.getViewName = function(instructions) {
    return 'type='+(instructions.type || 'all');
};

exports.createViewIfNull = function(instructions, cb) {
    templater.couch.getDesign('master', function(err, doc) {
        if(err) {
            return cb(new Error('There was a fatal error, master design not found!', err));
        }
        var viewName = templater.getViewName(instructions);

        if(!doc.views[viewName]) {
            // View does not exist. Make it!
            if(instructions.type) {
                doc.views[viewName] = {
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
                doc.views[viewName] = {
                    map: function(doc) {
                        if(doc.template) {
                            emit(doc.parent_id, doc);
                        }
                    }
                };
            }
            templater.couch.saveDesign('master', doc, function(err) {
                if(err) {
                    // If we have a document update conflict on saving a map function then 
                    // most likely another template raced to create it. TODO: This could
                    // be an issue for multiple lists modifying the design document at once!
                    // Maybe save them all to make at end?
                    if(err.error == 'conflict') {
                        return cb(null, viewName);
                    }
                    cb(err, viewName);
                } else {
                    cb(err, viewName);
                }
            });
        } else {
            cb(null, viewName);
        }
    });
};

// Render the {{element}} aspect of a list
//exports.renderListElement = function(index, urlObj, view_template, listData, elementData, cb) {
    //cb(null, listData.element.replace('{{child}}', '<span class="edit_list_item" id="'+(elementData._id || elementData.id)+'">'+rendered_content+'</span>'));
//};

// Get the data from an object and replace it into its proper plip, like {{ }}. Also handles includes
//exports.getData = function(user, urlObject, plip, pageData, cb) {
            //callback = function(err, val) {
                //cb(err, '<span class="edit_list" id="'+edit_id+'">'+val+'</span>');
            //};
		//} else if(!instructions.noEdit) {
			//cb(null, '<span class="edit_me" id="'+edit_id+'">'+val+'</span>');
//};

//exports.parseTemplate = function(user, urlObj, pageData, canHaveGlobal, cb) {
		//if(user.isAdmin) {
            //Add admin files to front end, and pass variables about current ids for page context. TODO: This is shittacular on so many levels
            //TODO: Also, uglify some shit up in this bitch
			//parsed = parsed.replace('</body>', function() {
					//return adminFiles+
						//'<script>var current_id="'+pageData._id+'", current_url_id="'+urlObj._id+'", access_urls='+JSON.stringify(prefixii)+';'+
						//transientFunctions+'</script></body>';
			//});
		//} else {
			//parsd = parsed.replace('</body>', function() {
				//return transientFunctions+'</script></body>';
			//});
		//}
		//parsed = parsed.replace(/<\/form>/g, function() {
			//return '<input type="hidden" name="current_id" value="'+pageData._id+'"><input type="hidden" name="current_url_id" value="'+urlObj._id+'"></form>';
		//});
//};
