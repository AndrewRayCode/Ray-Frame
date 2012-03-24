var log = require('simple-logger'),
    sys = require('util'),
    utils = require('./utils');

function makeCompiler() {
    var buffer = predent = outdent = blocks = list = includes = '',
        identifier = 'str',
        itemsToCache = {},
        viewsToCreate = [],
        iterator = 0,
        visiting = {},
        loopVars = [],
        guests = {},

        // populated by compile()
        context,
        hasExtends,
        hasBlocks,
        hasIncludes,
        isList,
        isMasterList,
        renderFromThisContext;

    var extend = function(walkers) {
        guests = walkers;
    };

    var visit = function(node, ancestor) {
        var vistFn,
            visitKey,
            visited,
            returned;

        if(node.length) {
            visitKey = 'nodeList';
        } else {
            visitKey = (node.arity !== 'name' && (visitors[node.value] || guests[node.value])) ?
                node.value : node.arity;
        }
        
        if((visitFn = (guests[visitKey] || visitors[visitKey]))) {
            if(ancestor) {
                node.ancestor = ancestor;
                node.ancestorIsList = true;
            // Pass in of null means assign no ancestor
            } else if(ancestor !== null) {
                node.ancestor = visiting;
            }
            visiting = node;

            returned = visitFn(node, visitors[visitKey]);
            return typeof returned === 'string' ? returned : visitors[visitKey](node);
        } else {
            log.warn('Warning on ' + context.fileName + ': Node compiler not implemented: ' + visitKey, ': `'+ node.value + '` (' + node.arity + ')');
            return '';
        }
    };

    // Recursively search this node for a child node matching the search value.
    // Return on first match
    var hasChild = function(node, value) {
        // If this isn't a nodelist, turn it into one
        var nodes = (node.length ? node : [node]),
            i = 0,
            toSearch,
            found;

        for(; toSearch = nodes[i++];) {
            if(toSearch.value === value) {
                return node;
            }
            if((found = (toSearch.first && hasChild(toSearch.first, value))
                || (toSearch.second && hasChild(toSearch.second, value))
                || (toSearch.third && hasChild(toSearch.third, value)))) {
                return found;
            }
        }
    };

    var empty = function() {
        return '';
    };

    var visitors = {
        'start': empty,
        'end': empty,
        'beforeBlock': empty,
        'afterBlock': empty,
        'template': function(node) {
            if(node.value && node.value.length) {
                return addQuotedString(escapeChars(node.value));
            }
            return '';
        },
        'if': function(node) {
            var asyncOutput = [],
                visited,
                output = '',
                asyncChild;

            // Weed out all the async if calls. This digs into else branhces too
            while((asyncChild = hasChild(node, 'async'))) {
                visited = visitors.async(asyncChild);

                // Replace the async block with a literal equal to the result of the
                // async function call created by the above visit statement. Note we
                // are modifying the tree in place here
                asyncChild.arity = 'literal';

                // Look, I know this is stupid. But for now it works. We're finding the variable
                // the async function returned by looking at the actual javascript
                asyncChild.value = visited.match(/\(err, (__[a-z]{2})\)/)[1];
                asyncChild.state = node.state;

                asyncOutput.push(visited);
            }

            output = asyncOutput.join('')
                + 'if(' + visit(node.first) + ') {'
                + visit(node.second);

            if(node.third) {
                output += '} else ' + visit(node.third);
            } else {
                output += '}';
            }

            return output;
        },
        // Function call, like `trim()`
        '(': function(node) {
            var parameters = [],
                parameter,
                x = 0;
            // Parse the parameters
            if(node.second instanceof Array) {
                for(; parameter = node.second[x++];) {
                    parameters.push(visit(parameter));
                }
                parameters = parameters.join(',');
            } else {
                parameters = visit(node.second);
            }
            return 'templater.functions["' + node.first.value + '"](' + parameters + ')';
        },
        '==': function(node) {
            return visit(node.first) + '==' + visit(node.second);
        },
        '||': function(node) {
            return visit(node.first) + '||' + visit(node.second);
        },
        '&&': function(node) {
            return visit(node.first) + '&&' + visit(node.second);
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
                    + visitors.beforeBlock(node)
                    + visit(node.second)
                    + visitors.afterBlock(node)
                    + 'cb(null, ' + identifier + ');'
                    + '};';
            } else {
                blocks += 'data.blocks' + 
                    (hasExtends ? '.extender["' + blockName + '"] = data.blocks.extender["' + blockName + '"] || '
                    : '["' + blockName + '"] = ')
                    + 'function(cb) {'
                    + 'var ' + identifier + ' = "";'
                    + visitors.beforeBlock(node)
                    + visit(node.second)
                    + visitors.afterBlock(node)
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
            var i = nextProbablyUniqueName(),
                needsLoop = hasChild(node, 'loop'),
                output = loopUpdate ='',
                second = visit(node.second),
                loop;

            if(needsLoop) {
                loopVars.push(nextProbablyUniqueName());
                loop = 'loop["' + getLoop() + '"]';

                output = loop + ' = {index: 0, even: true, odd: false};';
                loopUpdate = 
                    loop + '.index++;'
                    + loop + '.even = !' + loop + '.even;'
                    + loop + '.odd = !' + loop + '.odd;'
                    + loop + '.first = ' + loop + '.index === 1;'
                    + loop + '.last = ' + loop + '.index === ' + second + '.length;';
            }

            // Iterate over a dictionary (first will be [key, value])
            if(node.first.length) {
                var key = node.first[0].value,
                    value = node.first[1].value;

                output += 'for(context.locals["' + key + '"] in ' + second + ') {'
                    + 'context.locals["' + value + '"] = ' + second + '[context.locals["' + key + '"]];'
                    + loopUpdate
                    + visit(node.third)
                    + '}'; 
            } else {
                // or iterate over an array
                output += 'for(var ' + i + '=0; context.locals["' + node.first.value + '"] = ' + second + '[' + i + '++];) {'
                    + loopUpdate
                    + visit(node.third)
                    + '}'; 
            }

            if(needsLoop) {
                loopVars.pop();
            }

            return output;
        },
        // A list of statements
        'nodeList': function(list) {
            var i = 0,
                node,
                output = '';

            for(; node = list[i++];) {
                output += visit(node, list.ancestor || null);
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
                } else if(firstValue == 'list') {
                    output = 'data.list["' + secondValue  + '"]';
                } else if(firstValue == 'loop') {
                    output = 'loop["' + getLoop() + '"]["' + secondValue  + '"]';
                } else if(firstValue == 'locals') {
                    output = 'data[pageId].locals["' + secondValue  + '"]';
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
            var output,
                ref;

            if(node.plipValues && ('list' in node.plipValues)) {
                viewsToCreate.push(node);

                var viewName = getViewName(node);

                itemsToCache[viewName] = {
                    field: node.plipName,
                    userSort: node.plipValues.sort == 'user',
                    list: true
                };

                output = 'data.listField = "' + node.plipName + '";'
                    + 'templater.templateCache["' + utils.getListName(node.plipValues) + context.role.name + '"]'
                    + '(cache, templater, user, pageId, data, function(err, parsed) {'
                    + 'if(err) { return cb(err); }'
                    + addString('parsed');
                outdent += '});';

                return output;
            }

            output = '(context.locals["' + node.value + '"] || context.model["' + node.value + '"])';

            // If this is a {{ plip }} just add it to the template output
            if(node.state == 'plip') {
                return addString(output);
            }

            return output;
        },
        'literal': function(node) {
            return node.value;
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
        },
        // As asynchronous function call
        'async': function(node) {
            // Get the actual function call
            var functionNode = node.first,
                parameters = [],
                parameter,
                x = 0;

            // Get the parameters (should this be abstracted?)
            if(functionNode.second instanceof Array) {
                for(; parameter = functionNode.second[x++];) {
                    parameters.push(visit(parameter));
                }
                parameters = parameters.join(',');
            } else {
                parameters = visit(functionNode.second);
            }

            if(parameters) {
                parameters = ',' + parameters;
            }

            outdent = '});' + outdent;

            // Make the async call
            return 'templater.functions["' + functionNode.first.value + '"]'
                + '(pageId, data' + parameters + ', function(err, ' + nextProbablyUniqueName() + ') {';
        }
    };

    // Generate a two letter variable name prefixed by two underscores
    var nextProbablyUniqueName = function() {
        var alphabet = 'abcdefghijklmnopqurstuvwxyz',
            chr = alphabet[Math.floor(iterator / alphabet.length) % alphabet.length] + alphabet[iterator % alphabet.length];
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

    var getLoop = function() {
        return loopVars[loopVars.length - 1];
    };

    var compile = function(treeData, compileContext) {
        this.context = context = compileContext;
        this.hasExtends = hasExtends = treeData.metadata.hasExtendsStatement;
        this.hasBlocks = hasBlocks = treeData.metadata.hasBlocks;
        this.hasIncludes = hasIncludes = treeData.metadata.hasIncludeStatement;
        this.isList = isList = treeData.metadata.isList;
        this.isMasterList = isMasterList = isList && context.fileName == 'master-list.html';
        this.renderFromThisContext = renderFromThisContext = !hasExtends && !isList;

        var contentBeforeOutdent = visit({value: 'start'}) + visit(treeData.ast) + visit({value: 'end'});

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
                + 'data.list = {total: total};'
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
        compiled =
            'var ' + identifier + ' = "", loop = {};'
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
    };

    return {
        compile: compile,
        extend: extend,
        nextProbablyUniqueName: nextProbablyUniqueName,
        addQuotedString: addQuotedString,
        addString: addString,
        escapeChars: escapeChars,
        getViewName: getViewName,
        getLoop: getLoop,
        identifier: identifier,
        blocks: blocks
    };
}

var compiler = module.exports;
compiler.makeCompiler = makeCompiler;
