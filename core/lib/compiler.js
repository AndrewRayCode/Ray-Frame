var log = require('simple-logger'),
    sys = require('sys'),
    utils = require('./utils');

function compile(treeData, context) {
    var buffer = predent = outdent = blocks = list = includes = '',
        identifier = 'str',
        itemsToCache = {},
        viewsToCreate = [],
        hasExtends = treeData.metadata.hasExtendsStatement,
        hasBlocks = treeData.metadata.hasBlocks,
        hasIncludes = treeData.metadata.hasIncludeStatement,
        isList = treeData.metadata.isList,
        isMasterList = isList && context.fileName == 'master-list.html',
        renderFromThisContext = !hasExtends && !isList,
        iterator = 0,
        visiting = {};

    var visit = function(node, noAncestor) {
        var vistFn,
            visitKey,
            visited;

        if(node.length) {
            return visitors.nodeList(node);
        }

        visitKey = visitors[node.value] ? node.value : node.arity;
        
        if((visitFn = visitors[visitKey])) {
            if(!noAncestor) {
                node.ancestor = visiting;
            } else {
                node.ancestor = {};
            }
            visiting = node;
            return visitFn(node);
        } else {
            log.warn('Warning: Node compiler not implemented: ' + visitKey, ': ', node.value + ' (' + node.arity + ')');
            return '';
        }
    };

    var visitors = {
        'template': function(node) {
            if(node.value && node.value.length) {
                return addQuotedString(escapeChars(node.value));
            }
            return '';
        },
        'if': function(node) {
            var output = 'if(' + visit(node.first) + ') {'
                + visit(node.second);

            if(node.third) {
                output += '} else ' + visit(node.third);
            } else {
                outdent += '}';
            }

            return output;
        },
        'block': function(node) {
            var blockName = node.first.value;
            if(isList && blockName == 'element') {
                blocks += 'data.blocks.element = '
                    + (isMasterList ? 'data.blocks.extender.element || data.blocks.element || '
                            : '') 
                    + 'function(docs, index, cb) {'
                    + 'var ' + identifier + ' = "",'
                    + '    context = data[docs[index]];'
                    + visit(node.second)
                    + 'cb(null, ' + identifier + ');'
                    + '};';
            } else {
                blocks += 'data.blocks' + 
                    (hasExtends ? '.extender["' + blockName + '"] = data.blocks.extender["' + blockName + '"] || '
                    : '["' + blockName + '"] = ')
                    + 'function(cb) {'
                    + 'var ' + identifier + ' = "";'
                    + visit(node.second)
                    + 'cb(null, ' + identifier + ');'
                    + '};';

                // Render the block
                if(renderFromThisContext) {
                    outdent += '});';
                    return '(data.blocks.extender["' + blockName + '"] || data.blocks["' + blockName + '"])(function(err, parsed) {'
                        + addString('parsed');
                }
            }
            return '';
        },
        'include': function(node) {
            outdent += '});';
            var id = node.first.value;
            itemsToCache[id] = false;

            // Get the blocks from the included page
            // TODO: We need to build the have / find and sys.inspect
            includes += 'data["' + id + '"] = data["' + id + '"] || {};'
                + 'data["' + id + '"].parent = pageId;'
                + 'data.included = true;'
                + 'templater.templateCache["' + id + context.role.name + '"]'
                + '(cache, templater, user, "' + id + '", data, function(err) {'
                + 'data.included = false;';
            return '';
        },
        'extends': function(node) {
            var id = node.first.value;
            itemsToCache[id] = false;

            // Render the parent with our blocks
            outdent = 'templater.templateCache["' +  id + context.role.name + '"]'
                + '(cache, templater, user, "' + id + '", data, function(err, parsed) {'
                + 'cb(err, parsed)'
                + '});'
                + outdent;

            return '';
        },
        'localextends': function(node) {
            var id = node.first.value;
            itemsToCache[id] = false;

            // Render the parent with our blocks
            outdent = 'templater.templateCache["' +  id + context.role.name + '"]'
                + '(cache, templater, user, pageId, data, function(err, parsed) {'
                + 'cb(err, parsed)'
                + '});'
                + outdent;

            return '';
        },
        'for': function(node) {
            var i = nextIterator();

            // Iterate over a dictionary
            if('key' in node.first) {
                var second = visit(node.second),
                    key = node.first.key,
                    value = node.first.value;
                return 'var item;for(context.locals["' + key + '"] in ' + second + ') {'
                    + 'context.locals["' + value + '"] = ' + second + '["' + key + '"]'
                    + visit(node.third)
                    + '}'; 
            }
            // Iterate over an array
            return 'var item;for(var ' + i + '=0; context.locals["' + node.first.value + '"] = ' + visit(node.second) + '[' + i + '++];) {'
                + visit(node.third)
                + '}'; 
        },
        // A list of statements
        'nodeList': function(list) {
            var i = 0,
                node,
                output = '';

            for(; node = list[i++];) {
                output += visit(node, true);
            }
            return output;
        },
        '.': function(node) {
            var first,
                firstValue = node.first.value,
                secondValue = node.second.value,
                outptut = '';

            if(node.first.arity == 'name') {
                if(firstValue == 'child') {
                    output = 'context.model["' + secondValue + '"]';
                } else if(firstValue == 'loop') {
                    output = 'data.loop["' + secondValue  + '"]';
                } else {
                    output = 'context.model["' + firstValue + '"]["' + secondValue + '"]';
                }
            } else {
                output = visit(node.first) + '["' + secondValue + '"]';
            }

            if(node.ancestor.arity == 'binary') {
                return output;
            } else {
                return addString(output);
            }

        },
        '=': function(node) {
            return visit(node.first) + '=' + visit(node.second) + ';';
        },
        'name': function(node) {
            var output = '',
                ref;

            if(node.plipValues && ('list' in node.plipValues)) {
                viewsToCreate.push(node);

                var viewName = getViewName(node);

                itemsToCache[viewName] = {
                    field: node.plipName,
                    userSort: node.plipValues.sort == 'user',
                    list: true
                };

                output += 'data.listField = "' + node.plipName + '";'
                    + 'templater.templateCache["' + utils.getListName(node.plipValues) + context.role.name + '"]'
                    + '(cache, templater, user, pageId, data, function(err, parsed) {'
                    + 'if(err) { return cb(err); }'
                    + addString('parsed');
                outdent += '});';

                return output;
            }

            return addString('context.model["' + node.value + '"]');
        },
        'literal': function(node) {
            return 'literal';
        },
        'list': function(node) {
            if(!isMasterList) {
                visitors.localextends({
                    first: {
                        value: 'master-list.html'
                    }
                });
            }
            // Intentionally blank, list tags just set a flag in the metadata
            return '';
        }
    };

    var empty = function() {};

    // Limits nested to loops to 26 nests. If you are doing that, you have bigger problems
    var nextIterator = function() {
        var alphabet = 'abcdefghijklmnopqurstuvwxyz',
            chr = alphabet[iterator % alphabet.length];
        iterator++;
        return '__' + chr;
    };

    var addQuotedString = function(val) {
        return addString('"' + val.replace(/\n|\r/g, '\\n') + '"');
    };

    var addString = function(val) {
        return identifier + '+=' + val + ';';
    };

    var escapeChars = function(str) {
        return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    };

    var getViewName = function(node) {
        return 'type=' + (node.plipValues.type || 'all') + (node.plipValues.sort ? '-' + node.plipValues.sort + '-' + node.plipName : '');
    };

    var contentBeforeOutdent = visit(treeData.ast);

    if(isMasterList) {
        list = // Total is all the list elements, plus start and end blocks
            'var docs = data[pageId].model[data.listField],'
            + '    total = docs.length + 2,'
            + '    processed = x = 0,'
            + '    finished = [],'
            + '    start = end = "",'
            + '    page;'
            + 'var exit = function(index, str) {'
                + 'str && (finished[index] = str);'
                + 'if(++processed == total) {'
                    + 'cb(null, start + finished.join("") + end);'
                + '}'
            + '};'
            + 'data.loop = {total: total};'
            + 'data.blocks.start(function(err, parsed) {'
                + 'start = parsed;'
                + 'exit();'
            + '});'
            + 'data.blocks.end(function(err, parsed) {'
                + 'end = parsed;'
                + 'exit();'
            + '});'
            + 'for(; page = docs[x++];) {'
                + '(function(index) {'
                    + 'data.blocks.element(docs, index, function(err, parsed) {'
                        + 'exit(index, parsed);'
                    + '});'
                + '})(x - 1);'
            + '}';
    }

    //return new Function('cache', 'templater', 'user', 'pageId', 'data', 'cb', funcStr);
    var compiled =
        'var ' + identifier + ' = "";'
        //+ parseData.declarations
        + 'cache.fillIn(data, ' + sys.inspect(itemsToCache) + ', pageId, function(err) {'
            + 'var context = data[pageId];'
            //+ 'var entryId = pageId;'
            + 'if(err) { return cb(err); }'
            + ' try {'
            // Set up defined blocks if we have them
            + blocks
            + includes
            + contentBeforeOutdent
            // Render this page if we aren't passing control to another page
            + (list || (renderFromThisContext ? 
                    'if(!data.included) {'
                    + 'cb(null, ' + identifier + ');'
                    + '} else {'
                    + 'cb(null, data);'
                    + '}'
                : ''))
            + outdent
            + '} catch(e) {'
            + 'cb(e);'
            + '}'
        + '});';

    return {
        compiled: compiled,
        views: viewsToCreate
    };
}

var compiler = module.exports;
compiler.compile = compile;
