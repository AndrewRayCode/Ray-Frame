var templater = module.exports,
    log = require('simple-logger'),
    sys = require('util'),
	fs = require('fs'),
	path = require('path'),
    transients = require('../transients'),
    cache = require('./cache'),
    utils = require('./utils'),
    uglify = require('uglify-js'),
    lexer = require('./lexer'),
    parser = require('./parser'),
    q = require('q'),
    compiler = require('./compiler'),
    adminCompiler = require('./admin_compiler'),
    themesDirectory = '../../user/themes/',
    coreTemplateDir = '../static/';

log.level = 'info';

// Function code available on front end and back end
exports.transientFunctions = '';

// Serve a template from cache or get new version
exports.render = function(template, user, context, cb) {
    var data = {
        blocks: {
            extender: {}
        }
    };

    data[context._id] = {
        model: context,
        locals: {a:3}
    };

    //log.error('serving ',pageData.template + user.role);
    //console.log(templater.templateCache[pageData.template + user.role].toLocaleString());

    // function('cache', 'templater', 'user', 'pageId', 'data', 'cb');
    templater.templateCache[template + user.role](cache, templater, user, context._id, data, function(err, txt) {
        if(err) {
            cb(null, err.stack.replace(/\n/g, '<br />')
                + '<hr />'
                + templater.rawCache[template + user.role].compiled.toLocaleString().replace(/</g, '&lt;').replace(/>/g, '&gt;')
                + '<hr />');
        } else {
            cb(err, txt);
        }
    });
};

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
            //if(files[l].indexOf('index.html') > -1 
                //|| files[l].indexOf('test.html') > -1 
                //|| files[l].indexOf('master-list.html') > -1 
                //|| files[l].indexOf('link.html') > -1
                //|| files[l].indexOf('cow.html') > -1) {
                process(files[l]);
            //} else {
                //total--;
            //}
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
        templater.processTemplateString(baseName, contents, options, function(err, data) {
            if(err && !hasErrored) {
                hasErrored = true;
                return cb(new Error('Error processing `' + filepath + '`: ' + err.message));
            } else if(hasErrored) {
                return;
            }

            // Save the funciton string in our cache
            templater.templateCache[cachedName] = templater.mangleToFunction(data.compiled, filepath);

            // Also save the raw data in case we need to do anything else tricky with this template, like
            // use it as a wrapper
            cb(null, (templater.rawCache[cachedName] = data));
        });
    });
};

exports.mangleToFunction = function(inputFunction, filepath) {
    var outputFunction;
    try {
        outputFunction = uglify(inputFunction);
    } catch(err) {
        log.warn('Error parsing "' + filepath + '"' + err.message);
        outputFunction = 'cb(null, "Template function string could not be parsed, syntax error found by uglify-js. This is bad.'
            + '<br />' + err.stack.replace(/\n/g, '<br />')
            + '<hr />' 
            + inputFunction
                .replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\n|\r/g, '\\n')
                .replace(/([^\\])"("?)/g, function(match, group1, group2) {
                    return group1 + '\\"' + (group2 ? '\\"' : '');
                })
            + '");';
    }
    return new Function('cache', 'templater', 'user', 'pageId', 'data', 'cb', outputFunction);
};

// Take raw template string from the filesystem and feed it to the parser. Store the parser's output in a meaningful way
// so that the data can be used in other areas
exports.processTemplateString = function(fileName, template, options, cb) {
    var tokens = lexer.tokenize(template),
        treeData = parser.parse(tokens),
        //output = compiler.makeCompiler().compile(treeData, {
        output = adminCompiler.makeCompiler().compile(treeData, {
            role: options.permission,
            fileName: fileName
        });

    templater.createViews(output.views, function(err) {
        cb(err, output);
    });
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
    }, parts, fields, dotSplit;

    if(!plip.indexOf('listItem:')) {

        // listItem:field_on_parent:child_id:index
        fields = plip.split(':');

        conclusion.listItem = true;
        conclusion.parentField = fields[1];
        conclusion.doc_id = fields[2];
        conclusion.listIndex = fields[3];
    } else {
        // Example: "plip:global.html@info". the actual plip is just "info"
        if(!plip.indexOf('plip:')) {
            parts = plip.match(/:(.+?)@(.+?)$/);

            conclusion.doc_id = parts[1];
            conclusion.isPlip = true;

            plip = parts[2];
            conclusion.plip = plip;

            if(plip.indexOf('widget=') == -1) {
                conclusion.widget = 'default';
            }
        } else if(!plip.indexOf('list:')) {
            conclusion.widget = 'list';
            parts = plip.match(/:(.+?)@(.+?)$/);

            plip = parts[2];
            conclusion.doc_id = parts[1];
        }

        fields = plip.split(':');
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
        processed = 0,
        x = 0,
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
    templater.couch.get('_design/master').then(function(doc) {
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

            return templater.couch.save('_design/master', doc).then(function() {
                cb(null, viewName);
            });
        }
    }).fail(function(err) {
        // If we have a document update conflict on saving a map function then 
        // most likely another template raced to create it. TODO: This could
        // be an issue for multiple lists modifying the design document at once!
        // Maybe save them all to make at end?
        if(err && err.error == 'conflict') {
            return cb(null, viewName);
        }
        cb(err);
    });
};

exports.functions = {
    trim: function(str) {
        return 3;
    },
    test: function(id, data, val1, val2, callback) {
        callback(null, true);
    }
};
