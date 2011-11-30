var log = require('simple-logger'),
    utils = require('./utils');

function compile(treeData, context) {
    var buffer = '',
        predent = '',
        outdent = '',
        identifier = 'str',
        viewsToCreate = [],
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
                return addQuotedString(node.value);
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

            // TODO: Make context data[pageId]
            return addString('context["' + node.plipName + '"]');
        },
        'block': function(node) {
            return 'data.blocks["' + node.first.value + '"] = '
                + (treeData.hasExtendsStatement ? 'data.blocks["' + node.first.value + '"] || ' : '')
                + 'function() {'
                + visit(node.second)
                + '};';
        },
        'include': function(node) {
            outdent += '});';
            var id = node.first.value;

            return 'data["' + id + '"].parent = pageId;'
                + 'templater.templateCache["' + id + context.role.name+'"]'
                + '(cache, templater, user, "' + id + '", data, function(err, parsed) {'
                + identifier + ' += parsed;';
        },
        'extends': function(node){
            var id = node.first.value;

            outdent = 'templater["' + id + '"]'
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
                return 'var item;for(locals["' + key + '"] in ' + second + ') {'
                    + 'locals["' + value + '"] = ' + second + '["' + key + '"]'
                    + visit(node.third)
                    + '}'; 
            }
            // Iterate over an array
            return 'var item;for(var ' + i + '=0; locals["' + node.first.value + '"] = ' + visit(node.second) + '[' + i + '++];) {'
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
                return '(data["' + node.first.value + '"]["' + node.second.value + '"]'
                    + ' || locals["' + node.first.value + '"]["' + node.second.value + '"])';
            }
        },
        '=': function(node) {
            return visit(node.first) + '=' + visit(node.second) + ';';
        },
        'name': function(node) {
            return '(data["' + node.value + '"]'
                + ' || locals["' + node.value + '"])';
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
        return addString('"' + val + '"');
    };

    var addString = function(val) {
        return identifier + '+=' + val + ';';
    };

    //return new Function('cache', 'templater', 'user', 'pageId', 'data', 'cb', funcStr);
    var compiled =
        'var ' + identifier + ' = "",'
            + 'context = data[pageId];'
        //+ parseData.declarations
        + 'cache.fillIn(data, pageId, function(err) {'
            //+ 'var entryId = pageId;'
            + 'if(err) { return cb(err); }'
            + visit(treeData.ast)
            // If we extend something, that's what we render with our blocks
            + (treeData.hasExtendsStatement ? 'cb(null, ' + identifier + ');' : '')
            + outdent
        + '});';

    return {
        compiled: compiled,
        views: viewsToCreate
    };
}

var compiler = module.exports;
compiler.compile = compile;