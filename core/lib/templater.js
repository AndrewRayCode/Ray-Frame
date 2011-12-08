var templater = module.exports,
    log = require('simple-logger'),
    sys = require('sys'),
	fs = require('fs'),
	path = require('path'),
    transients = require('../transients'),
    flowControl = require('./flower'),
    utils = require('./utils'),
    uglify = require('uglify-js'),
    lexer = require('./lexer'),
    parser = require('./parser'),
    compiler = require('./compiler'),
    themesDirectory = '../../user/themes/',
    coreTemplateDir = '../static/';

log.log_level = 'info';

//var a = lexer.tokenize('{% for oink in bob %}FUCK{% endfor %}');
//var a = lexer.tokenize('{% if oink || moo %}FUCK{% else if poop %}{% endif %}');
//var a = lexer.tokenize('{% if oink %}FUCK{% else if poop %}{% endif %}');
//var a = lexer.tokenize('{% if oink %} PPP {% endif %} balls');
//var a = lexer.tokenize('{% if oink %} PPP {% endif %}');
//var a = lexer.tokenize('{% bob = cheese %} moo');
//var a = lexer.tokenize('{% if oink %}FUCK{% else if poop %}{% endif %}');
//var a  = lexer.tokenize('{% block \'list.start\' %}a{% endblock %}');
var a  = lexer.tokenize('{% extends \'a.html\' %}{% block \'list.start\' %}a{% endblock %}');
//var a  = lexer.tokenize('{% include \'a.html\' %} bark bark');
//var a  = lexer.tokenize('{% block \'list.start\' %}'
        //+ '<ul>'
    //+ '{% endblock %}'
    //+ '{% block \'list.item\' %}'
        //+'<li>{{ child }}</li>'
    //+ '{% endblock %}'
    //+ '{% block \'list.end\' %}'
        //+'</ul>'
    //+ '{% endblock %}');
var tokens = []; for(var t = 0; t < a.length; t++){tokens.push(a[t].type + ' ('+a[t].value+')');}
//log.info(tokens.join('\n'));
var treeData = parser.parse(a);
//log.error(treeData.ast);
var c = compiler.compile(treeData, {
    role: {name: 'admin'}
});
//log.warn('------------- final code -------------\n',c.compiled);
//log.error(uglify(c.compiled));

// Function code available on front end and back end
exports.transientFunctions = '';

exports.cacheTheme = function(theme, permissions, cb) {
    templater.templateCache = {};
    templater.rawCache = {};

    templater.theme = theme;
    
    // No real reason to do this more than once after a theme is set
    templater.templateDir = templater.getTemplateDir();
    templater.coreTemplateDir = templater.getCoreTemplateDir();

    templater.permissions = permissions;

    templater.listThemeAndCoreTemplates(function(err, files) {
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
                        return cb(err);
                    }
                });
            }
        }
        while(l--) {
            if(files[l].indexOf('index.html') > -1 
                || files[l].indexOf('test.html') > -1 
                || files[l].indexOf('master-list.html') > -1 
                || files[l].indexOf('cow.html') > -1) {
                process(files[l]);
            } else {
                total--;
            }
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
};

exports.cacheTemplate = function(filepath, options, cb) {
    var baseName = path.basename(filepath),
        cachedName = baseName + (options.permission ? options.permission.name : ''),
        hasErrored;

    // Was this template (like an include wrapper) already parsed?
    if(cachedName in templater.templateCache) {
        return cb();
    }

    fs.readFile(filepath, function(err, contents) {
        contents = contents.toString();
        templater.processTemplateString(contents, options, function(err, data) {
            if(err && !hasErrored) {
                hasErrored = true;
                return cb(new Error('Error processing `' + filepath + '`: ' + err.message));
            } else if(hasErrored) {
                return;
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
    try {
        funcStr = uglify(funcStr);
    } catch(e) {
        log.error(funcStr);
        throw new Error('Template function string could not be parsed, syntax error found by uglify-js. This is bad.');
    }
    return new Function('cache', 'templater', 'user', 'pageId', 'data', 'cb', funcStr);
};

// Template tag handlers. At some point this needs to be moved to its own file, or something, and users need to be able
// to define their own template handlers.
exports.handlers = {
    textNode: {
        handler: function(raw, cb) {
            var output = raw,
                splitStr;

            // Escape backslashes and quotes
            function escapeChars(str) {
                return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            }

            // Do not replace whitespace in pre mode
            if(this.state.indexOf('pre') == -1) {
                //output = output.replace(/\r|\n/g, ' ').replace(/\s+/g, ' ');

                // Append role includes (like admin javascript files) to the closing body tag if we find one
                if(this.role.wrapTemplateFields
                        && this.role.includes
                        && (splitStr = output.split(/(<\/body>)/g)).length > 1) {

                    // array like ['stuff', '</body>', 'more stuff']. If more than 3, more than 2 body tags were split on
                    if(splitStr.length > 3) {
                        log.warn('Warning, more than one closing body tag found in template. Appending admin functions to last.');
                    }

                    // 'a</body></html>' becomes ['a', 'admin functions', '</html>']
                    output = output.split(/(<\/body>)/g);

                    var transients = templater.transientFunctions;
                    if(!templater.debug) {
                        try {
                            transients = templater.uglify(transients);
                        } catch(e) {
                            throw new Error('Syntax error parsing transient functions!');
                        }
                    }
                    output.splice(-2, 0,
                        (this.role.includes
                        + '<script>'
                            + 'RayFrame.current_id="$$1"; RayFrame.current_url_id="$$2";'
                            + 'RayFrame.accessUrls=$$3; RayFrame.role = "$$4";'
                            + transients
                        + '</script>')
                        
                    );

                    var permissionIndex = templater.permissions.length,
                        urls = {};

                    while(permissionIndex--) {
                        var permission = templater.permissions[permissionIndex];
                        urls[permission.name] = permission.accessURL || permission.name;

                        if(this.role.name == permission.name) {
                            break;
                        }
                    }

                    // Rebuild the string, but when we get to the second to last entry (the admin functions), then
                    // append them to the output
                    this.append(
                        ('"' + escapeChars(output.join('')) + '"')
                            .replace('$$1', '" + entryId + "')
                            .replace('$$2', '" + data[entryId].variables.url + "')
                            .replace('$$3', sys.inspect(urls))
                            .replace('$$4', this.role.name)
                        );
                } else {
                    this.append('"' + escapeChars(output) + '"');
                }
            } else {
                this.append('"' + escapeChars(output) + '"');
            }
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
                    + 'templater.templateCache["'+instructions.field + this.role.name+'"](cache, templater, user, "'+instructions.field+'", data, function(err, parsed) {'
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
                    listTemplate = instructions.listBody,
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
                                        +'templater.templateCache[listTemplateName](cache, templater, user, listIds[index], data, function(err, parsed) {'
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
                                + (instructions.view) + me.role.name
                                + '", function(err, renderedItems) {');

                    // surrounding edit for list
                    me.startEdit('list', 'pageId', instructions.raw);
                    me.appendRaw(cachedList.buffers.start + 'for(var x = 0, listItem; listItem = renderedItems[x++];) {');

                    // surrounding edit for list item
                    me.startEdit('listItem', '"' + instructions.field + ':" + (listItem.id) + ":" + (x - 1)');

                    // list item opening (split on {% child %} )
                    me.appendRaw(pieces[0]);

                    // grabbed programmaticaly from template render
                    me.append('listItem.str');

                    // list item closing
                    me.appendRaw(';' + pieces[1] + ';');
                    me.endEdit();

                    // end of for loop, end edit
                    me.appendRaw('}' + cachedList.buffers.end);
                    me.endEdit();

                    me.parseData.afterTemplate += '});';
                    cb();
                };
                
                // Create view if needed
                templater.createViewIfNull(instructions, function(err, viewName) {
                    if(err) {
                        return cb(err);
                    }
                    me.parseData.itemsToCache[viewName] = {
                        field: instructions.field,
                        userSort: instructions.sort == 'user',
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
                    this.startEdit('plip', 'data[pageId].child', instructions.attr);
                }
                this.append(templater.whatDoesItMean(this.state, instructions.field));

                if(!instructions.noEdit) {
                    this.endEdit();
                }
                cb();
            }
        },{
            name: 'parent',
            matcher: /parent\./,
            handler: function(raw, cb) {
                var instructions = templater.getInstructions(raw);

                if(!instructions.noEdit) {
                    this.startEdit('plip', 'data[pageId].parent', instructions.attr);
                }
                this.append(templater.whatDoesItMean(this.state, instructions.field));

                if(!instructions.noEdit) {
                    this.endEdit();
                }
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
                    this.startEdit('plip', 'pageId', raw);
                }
                this.append('(data[pageId].locals["'+instructions.field+'"] || data[pageId].variables["'+instructions.field+'"] || "")');

                if(!instructions.noEdit) {
                    this.endEdit();
                }
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
};

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
    this.endEdits = [];

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
            this.buffers[buff] = {
                // The list of commands that will become the final function
                buffer: [],
                // Store up string concat statements to optimize code
                stringRun: []
            };
        }
    };

    // Remove the buffer state. If we are adding to the 'list' buffer, revert to the buffer we were previously adding to
    this.revertBuffer = function() {
        this.bufferStack.pop();
        this.outputBuffer = this.bufferStack[this.bufferStack.length - 1];
    };

    // Return all tracked buffers as {bufferName: string, bufferName2...}
    this.getBuffers = function() {
        var ret = {};
        for(var bufName in this.buffers) {
            ret[bufName] = this.getBuffer(bufName);
        }
        return ret;
    };

    // Get a named buffer, forces final string concat
    this.getBuffer = function(name) {
        this.flushStringRun(name);
        return this.buffers[name].buffer.join('');
    };

    // Append straight code to the template
    this.appendRaw = function(str) {
        this.append(str, true);
    };

    // Append code to the output string eventually shown to the user
    this.append = function(str, exact) {
        if(exact) {
            this.flushStringRun(this.outputBuffer);
            this.buffers[this.outputBuffer].buffer.push(str);
        } else {
            this.buffers[this.outputBuffer].stringRun.push(str);
        }
    };

    this.flushStringRun = function(bufferName) {
        var buffer = this.buffers[bufferName];
        if(buffer.stringRun.length) {
            buffer.buffer.push(this.identifier + ' += ' + buffer.stringRun.join(' + ') + ';');
            buffer.stringRun = [];
        }
    };

    this.startEdit = function(prefix, id, attr) {
        if(this.role.wrapTemplateFields) {
            this.appendRaw(this.identifier
                + ' += "<q id=\\"' + prefix + ':" + ' + id + (attr ? ' + "@' + attr + '"' : '') + ' + "\\" class=\\"rayframe-edit\\">";');

            this.endEdits.push('</q>');
        }
    };

    this.endEdit = function() {
        if(this.role.wrapTemplateFields && this.endEdits.length) {
            this.append('"' + this.endEdits.pop() + '"');
        }
    };

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
    };

    this.parse = function(input, cb) {
        this.swapBuffer('output');

        var html = '',
            me = this,
            flower = new flowControl(me),
            lineNumber = 1;

        for(var x = 0, l = input.length; x < l; x++) {
            var character = input[x];
            // the html variable is used to track blocks of plain old html text
            html += character;

            // Track line we are processing for error output
            if(character == '\n') {
                lineNumber++;
            }

            if(~this.starts.indexOf(character)) {
                for(var groupName in templater.handlers) {
                    var group = templater.handlers[groupName];
                    if(group.start && input.substr(x, group.start.length) == group.start) {
                        // Scan ahead till we find the end
                        var end = input.indexOf(group.end, x + 1),
                            contents = input.substring(x + group.start.length, end);

                        if(end == -1) {
                            return cb(new Error('Opening `' + group.start + '` found but no closing `' + group.end + '` found on line ' + lineNumber + '!'));
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
    };
};

// Take raw template string from the filesystem and feed it to the parser. Store the parser's output in a meaningful way
// so that the data can be used in other areas
exports.processTemplateString = function(template, options, cb) {
    var parseOptions = {
        identifier: 'str',
        role: options.permission
    };
    if(options.preState) {
        parseOptions.state = options.preState;
    }

    var tokens = lexer.tokenize(template);
    var treeData = parser.parse(tokens);
    var output = compiler.compile(treeData, {
        // TODO, get permissions from option
        role: {name: 'admin'}
    });

    templater.createViews(output.views, function() {
        cb(null, {
            funcString: output.compiled,
            parseData: {
                funcString: output.compiled,
                isList: output.isList
            }
        });
    });
        // function('cache', 'templater', 'pageId', 'data', 'cb');

        //var processedOutput = 
            //'var ' + parser.identifier + ' = "",'
            //+ 'found = ' + sys.inspect(parseData.itemsToCache) + ';'
            //+ parseData.declarations
            //+ 'cache.fillIn(data, found, pageId, function(err) {'
                //+ 'var entryId = pageId;'
                //+ 'if(err) { return cb(err); }'
                //+ parseData.beforeTemplate
                //+ parser.getBuffer('output')
                //+ parseData.afterTemplate
                //+ 'cb(null, ' + parser.identifier + ');'
            //+ '});';

        //cb(null, {
            //funcString: processedOutput,
            //Store our raw data in case something else needs to tear it apart
            //parseData: {
                //beforeTemplate: parseData.beforeTemplate,
                //afterTemplate: parseData.afterTemplate,
                //itemsToCache: parseData.itemsToCache,
                //declarations: parseData.declarations,
                //identifier: parser.identifier,
                //buffers: parser.getBuffers()
            //}
        //});
    //});
};

exports.addNamespace = function(namespace) {
    templater.transientFunctions += 'RayFrame["' + namespace + '"] = {};';
};

exports.addTransientFunction = function(name, reference) {
    templater.addNamespacedTransientFunction(null, name, reference);
};

// toString all the functions that we want to access on the front end
exports.addNamespacedTransientFunction = function(namespace, name, reference) {
    // TODO: Transient functions should probably require role permissions, like admin gets this, public gets this. addPublicTransientFuncitons would be good,
    // because who cares what methods the logged in content editor gets, they can't use them without back end authentication
    templater.transientFunctions += 'RayFrame'
        + (namespace ? '["' + namespace + '"]' : '')
        // Put all funcitons on the RayFrame.Transients objects. Replace 'module.fnName' to just 'fnName'. Collisions are possible, like utils.stuff()
        // will overwrite otherModule.stuff(), but I'm not worried right now
        + '["' + name + '"] = '
        // Ok, so there are a few problems with moving back end code to front end code, namely dependencies with require. Right now I'm just saying
        // you can only use functions in lib/utils.js in your transient functions. I don't want to have to resolving that bullshit.
        + reference.toLocaleString().replace(/(\W)utils\./g, '$1RayFrame.') + ';';
};

// Parse a "plip" which is anything in {{ }} on a template
exports.getInstructions = function(plip) {
    var conclusion = {
        raw: plip
    };

    if(!plip.indexOf('listItem:')) {

        // listItem:field_on_parent:child_id:index
        var fields = plip.split(':');

        conclusion.listItem = true;
        conclusion.parentField = fields[1];
        conclusion.doc_id = fields[2];
        conclusion.listIndex = fields[3];
    } else {
        // Example: "plip:global.html@info". the actual plip is just "info"
        if(!plip.indexOf('plip:')) {
            var parts = plip.match(/:(.+?)@(.+?)$/);

            conclusion.doc_id = parts[1];
            conclusion.isPlip = true;

            plip = parts[2];
            conclusion.plip = plip;

            if(plip.indexOf('widget=') == -1) {
                conclusion.widget = 'default';
            }
        } else if(!plip.indexOf('list:')) {
            conclusion.widget = 'list';
            var parts = plip.match(/:(.+?)@(.+?)$/);

            plip = parts[2];
            conclusion.doc_id = parts[1];
        }

        var fields = plip.split(':'),
            dotSplit = fields[0].split('.');

        // The key of the document
        conclusion.field = fields[0];

        // Say if this has an attribute like {{child.attr}}
        conclusion.attr = dotSplit[1] || null;

        // If this isn't an include it could have things like `view=a.html` or `type=blog`
        var index = fields.length;
        while(index--) {
            var split = fields[index].split('=');
            conclusion[split[0]] = split.length > 1 ? split[1] : true;
        }

        if(conclusion.list) {
            if(!conclusion.view) {
                conclusion.view = 'link.html';
            }
            if(!conclusion.listBody) {
                conclusion.listBody = 'list.html';
            }
        }
    }

    return conclusion;
};

// Recursively read all template files from the current theme //TODO: I feel like theme shouldn't be global
exports.listAllThemeTemplates = function(cb) {
    exports.listSpecificedTemplates(false, cb);
};

exports.listThemeAndCoreTemplates = function(cb) {
    exports.listSpecificedTemplates(true, cb);
};

// Recursively read all template files from the current theme //TODO: I feel like theme shouldn't be global
exports.listSpecificedTemplates = function(includeCore, cb) {
    // Save locations in cache
    if(templater.templatePaths) {
        return cb(null, templater.templatePaths);
    }

    var compile = function(err, data) {
        if(err) {
            return cb(err);
        }
        var templates = [],
            x = 0,
            file;
        for(; file = data.files[x++];) {
            // template must be .html files (not say .swp files which could be in that dir)
            if((/\.html$/).test(file)) {
                templates.push(file);
            }
        }

        templater.templatePaths = templates;
        cb(null, templates);
    };

    utils.readDir(templater.templateDir, function(err, data) {
        if(includeCore) {
            utils.readDir(templater.coreTemplateDir, function(err, coreData) {
                data.files = data.files.concat(coreData.files);
                data.dirs = data.dirs.concat(coreData.dirs);
                compile(err, data);
            });
        } else {
            compile(err, data);
        }
    });
};

// TODO: Nothing currently calls this, but might be useful for finding templates like 'list/bob.html' 
// given only 'bob.html'
exports.findTemplateAndGetSource = function(name, cb) {
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
            // include non html files?
            if(options.really_include_all || (/\.html$/).test(f)) {
                templates.push(f);
            }
        }
        cb(null, templates);
    });
};

exports.getTemplateDir = function() {
    return path.normalize(__dirname + '/' + themesDirectory + templater.theme + '/templates/');
};

exports.getCoreTemplateDir = function() {
    return path.normalize(__dirname + '/' + coreTemplateDir);
};

exports.getViewName = function(instructions) {
    return 'type=' + (instructions.type || 'all') + (instructions.sort ? '-' + instructions.sort + '-' + instructions.field : '');
};

templater.createViews = function(views, cb) {
    var total = views.length,
        processed = x = 0,
        view, plip;

    if(!total) {
        return cb();
    }

    var exit = function() {
        if(++processed == total) {
            cb();
        }
    };

    for(; view = views[x++];) {
        plip = view.plipValues;
        plip.field = view.plipName;
        templater.createViewIfNull(plip, exit);
    }
};

exports.createViewIfNull = function(instructions, cb) {
    templater.couch.getDesign('master', function(err, doc) {
        if(err) {
            return cb(new Error('There was a fatal error, master design not found!', err));
        }
        var viewName = templater.getViewName(instructions);

        if(doc.views[viewName]) {
            cb(null, viewName);

        // View does not exist. Make it!
        } else {
            // Sorted via an array of ids on the main document's field. Using include_docs=true
            // will make this view return the docs when queried 
            if(instructions.sort == 'user') {
                doc.views[viewName] = {
                    map: utils.formatFunction(function(doc) {
                        var field = doc[$1];
                        if(doc.template && field) {
                            emit(doc._id, {_id: doc._id});

                            for(var x = 0, id; id = field[x++];) {
                                emit(doc._id, {_id: id});
                            }
                        }
                    }, instructions.field)
                };
            // Sorted programmatically
            } else {
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
            }

            templater.couch.saveDesign('master', doc, function(err) {
                // If we have a document update conflict on saving a map function then 
                // most likely another template raced to create it. TODO: This could
                // be an issue for multiple lists modifying the design document at once!
                // Maybe save them all to make at end?
                if(err && err.error == 'conflict') {
                    return cb(null, viewName);
                }
                cb(err, viewName);
            });
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
