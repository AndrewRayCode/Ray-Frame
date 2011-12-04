var log = require('simple-logger'),
    sys = require('sys'),
    utils = require('./utils');

function compile(treeData, context) {
    var buffer = '',
        predent = '',
        outdent = '',
        blocks = '',
        includes = '',
        identifier = 'str',
        itemsToCache = {},
        viewsToCreate = [],
        hasExtends = treeData.metadata.hasExtendsStatement,
        hasBlocks = treeData.metadata.hasBlocks,
        renderFromThisContext = !hasExtends,
        iterator = 0;

    var visit = function(node) {
        var vistFn,
            visitKey;

        if(node.length) {
            return visitors.nodeList(node);
        }

        visitKey = visitors[node.value] ? node.value : node.arity;
        
        if((visitFn = visitors[visitKey])) {
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
        'plip': function(node) {
            var output = '';
            if('list' in node.plipValues) {
                viewsToCreate.push(node.plipValues);

                output += 'templater.templateCache["' + utils.getListName(node) + context.role.name + '"]'
                    + '(cache, templater, user, "' + node.plipName + '", data, function(err, parsed) {'
                    + addString('parsed');
                outdent += '});';

                return output;
            }

            return addString('context.model["' + node.plipName + '"]');
        },
        'block': function(node) {
            blocks += '\ndata.blocks["' + node.first.value + '"] = '
                + (renderFromThisContext ? 'data.blocks["' + node.first.value + '"] || ' : '')
                + 'function(cb) {'
                + 'var ' + identifier + ' = "";'
                + visit(node.second)
                + 'cb(null, ' + identifier + ');'
                + '};';

            // Render the block
            if(renderFromThisContext) {
                outdent += '});';
                return 'data.blocks["' + node.first.value + '"](function(null, parsed) {'
                    + addString('parsed');
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
        'extends': function(node){
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
                output += visit(node);
            }
            return output;
        },
        '.': function(node) {
            if(node.first.value == 'child') {
                return 'KHHAAAANNNN';
            } else {
                return '(context.model["' + node.first.value + '"]["' + node.second.value + '"]'
                    + ' || context.locals["' + node.first.value + '"]["' + node.second.value + '"])';
            }
        },
        '=': function(node) {
            return visit(node.first) + '=' + visit(node.second) + ';';
        },
        'name': function(node) {
            return '(context.model["' + node.value + '"]'
                + ' || context.locals["' + node.value + '"]);';
        },
        'literal': function(node) {
            return 'literal';
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

    var contentBeforeOutdent = visit(treeData.ast);

    //return new Function('cache', 'templater', 'user', 'pageId', 'data', 'cb', funcStr);
    var compiled =
        'var ' + identifier + ' = "",'
            + 'context = data[pageId];'
        //+ parseData.declarations
        + 'cache.fillIn(data, ' + sys.inspect(itemsToCache) + ', pageId, function(err) {'
            //+ 'var entryId = pageId;'
            + 'if(err) { return cb(err); }'
            // Set up defined blocks if we have them
            + (blocks ? 
                    'data.blocks = data.blocks || {};' + blocks
                : '')
            + includes
            + contentBeforeOutdent
            // Render this page if we aren't passing control to another page
            + (renderFromThisContext ? 
                    'if(!data.included) {'
                    + 'cb(null, ' + identifier + ');'
                    + '} else {'
                    + 'cb(null, data);'
                    + '}'
                : '')
            + outdent
        + '});';

    return {
        compiled: compiled,
        views: viewsToCreate
    };
}

var compiler = module.exports;
compiler.compile = compile;
