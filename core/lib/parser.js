var log = require('simple-logger');

// http://javascript.crockford.com/tdop/index.html
function error(token, message) {
    throw new Error(message);
}

function makeParser() {
    var scope,
        symbol_table = {},
        metadata = {},
        token,
        tokens,
        tokenIndex,
        state = 'template',
        topLevel;

    var itself = function() {
        return this;
    };

    var original_scope = {
        define: function(n) {
            var t = this.def[n.value];
            if(typeof t === 'object') {
                error(n, t.reserved ? 'Already reserved.' : 'Already defined.');
            }
            this.def[n.value] = n;
            n.reserved = false;
            n.nud      = itself;
            n.led      = null;
            n.std      = null;
            n.lbp      = 0;
            n.scope    = scope;
            return n;
        },
        find: function(n) {
            var e = this, o;
            while(true) {
                o = e.def[n];
                if(o && typeof o !== 'function') {
                    return e.def[n];
                }
                e = e.parent;
                if(!e) {
                    o = symbol_table[n];
                    return o && typeof o !== 'function' ? o : symbol_table['(name)'];
                }
            }
        },
        pop: function() {
            scope = this.parent;
        },
        reserve: function(n) {
            if(n.arity !== 'name' || n.reserved) {
                return;
            }
            var t = this.def[n.value];
            if(t) {
                if(t.reserved) {
                    return;
                }
                if(t.arity === 'name') {
                    error(n, 'Already defined.');
                }
            }
            this.def[n.value] = n;
            n.reserved = true;
        }
    };

    var new_scope = function() {
        var s = scope;
        scope = Object.create(original_scope);
        scope.def = {};
        scope.parent = s;
        return scope;
    };

    var advance = function(id) {
        var nextTokenArity, lookup, nextToken, nextTokenValue,
            startState = state;

        if(id && token.id !== id && id != 'state') {
            if(id == '(end)' && token.id != 'template') {
                error(token, 'Expected end of file, but instead got `' + token.id + '` (' + token.value + ')');
            } else {
                error(token, 'Expected ' + id + ', but instead got `' + token.id + '` (' + token.value + ')');
            }
        }

        // Look at the next token from the lexer. If it triggers nextTokenArity state change, like nextTokenArity '%}' or '{{',
        // record the new state and read the next token. Pretend like nothing happened.
        do {
            if(nextTokenArity) {
                if(state === 'template') {
                    state = nextTokenArity;
                } else {
                    state = 'template';
                }
            }

            if(tokenIndex >= tokens.length) {
                token = symbol_table['(end)'];
                return;
            }
            nextToken = tokens[tokenIndex];
            tokenIndex += 1;
            nextTokenValue = nextToken.value;
            nextTokenArity = nextToken.type;
        } while (nextTokenArity == 'controller' || nextTokenArity == 'plip');

        if(state == 'controller' || state == 'plip') {
            if(nextTokenArity === 'name') {
                if(nextTokenValue === 'list' && state === 'plip') {
                    lookup = symbol_table['(name)'];
                } else {
                    lookup = scope.find(nextTokenValue);
                }
            } else if(nextTokenArity === 'operator') {
                lookup = symbol_table[nextTokenValue];
                if(!lookup) {
                    error(nextToken, 'Unknown operator:' + token.value);
                }
            } else if(nextTokenArity === 'string' || nextTokenArity ===  'number') {
                lookup = symbol_table['(literal)'];
                nextTokenArity = 'literal';
            } else {
                error(nextToken, 'Unexpected token: `' + nextToken.value + '`');
            }
        } else if(state == 'template') {
            lookup = symbol_table[nextTokenArity];
        }
        
        token = Object.create(lookup);
        token.from  = nextToken.from;
        token.to    = nextToken.to;
        token.value = nextTokenValue;
        token.arity = nextTokenArity;
        token.state = state;
        return token;
    };

    var expression = function(rbp) {
        var testToken = token,
            left, plipPiece, expressionToken;

        advance();

        // Look for plips, which can be things like a:b=c:d which isn't easy to describe with
        // the current syntax methods, so manually read the full plip
        if(state == 'plip' && testToken.arity == 'name' && token.value == ':') {
            plip = Object.create(symbol_table['(literal)']);
            plip.plipName = testToken.value;
            plip.plipValues = {};
            plip.arity = 'name';
            plip.state = 'plip';

            while(token.value == ':') {
                advance();
                if(token.arity == 'name') {
                    plipPiece = token.value;
                    advance();

                    // If we encountered {plipPiece}={thing}, advance to =, capture thing, then advance to next token
                    if(token.value == '=') {
                        advance();
                        plip.plipValues[plipPiece] = token.value;
                        advance();
                    // Otherwise this isn't an assignment, It's just name:thing, capture thing and we're already on the next
                    // token, so don't advance
                    } else {
                        plip.plipValues[plipPiece] = null;
                    }
                } else {
                    error('There is something medically wrong with your plip, expected name or assignment but got: `' + token.value + '`');
                }
            }

            // Finally, 
            expressionToken = plip;
        } else {
            // In the interest of less mutability ;)
            expressionToken = testToken;
        }

        left = expressionToken.nud();

        while(rbp < token.lbp) {
            expressionToken = token;
            advance();
            left = expressionToken.led(left);
        }
        return left;
    };

    var statement = function() {
        var n = token, v;
        if(n.std) {
            advance();
            scope.reserve(n);
            return n.std();
        }
        // Crockford does advance(';') here, and I tried advance('state'), but advance already exits on a state
        // change, so it is implied
        return expression(0);
    }; 

    // Process the next statement(s) until the end of the file or an ending token id is reached
    var statements = function() {
        var nextStatements = [],
            newStatement,
            endables = Array.prototype.slice.call(arguments),
            startState = state,
            preToken, preTokenIndex, preState;

        while(true) {
            if(token.id == '(end)' && endables.length) {
                error(token, 'Expected `' + endables.join('` or `') + ' before end of file.');
            } else if(token.id === '}' || token.id === '(end)' || (!endables.length && (startState != state))) {
                break;
            }

            // Store our current token before checking for a possible ending token.
            preToken = token;
            preTokenIndex = tokenIndex;
            preState = state;

            if((newStatement = statement())) {
                // Did we reach an end condition for this statement?
                if((endables.indexOf(newStatement.id) > -1)) {
                    // If statements() is passed a value like 'endif' then we expect the value 
                    // of 'token' to be 'endif' after statements() runs, so reset token to the
                    // value it was before 'endif'
                    token = preToken;
                    tokenIndex = preTokenIndex;
                    state = preState;
                    break;
                }
                nextStatements.push(newStatement);
            }
        }
        return !nextStatements.length ? null : nextStatements.length === 1 ? nextStatements[0] : nextStatements;
    };

    var block = function() {
        var t = token;
        advance('{');
        return t.std();
    };

    var original_symbol = {
        nud: function() {
            // We don't know scope variables, so don't error
            return this;
        },
        led: function(left) {
            error(this, 'Missing operator.');
        }
    };

    var symbol = function(id, bp) {
        var s = symbol_table[id];
        bp = bp || 0;
        if(s) {
            if(bp >= s.lbp) {
                s.lbp = bp;
            }
        } else {
            s = Object.create(original_symbol);
            s.id = s.value = id;
            s.lbp = bp;
            symbol_table[id] = s;
        }
        return s;
    };

    var constant = function(s, v) {
        var x = symbol(s);
        x.nud = function() {
            scope.reserve(this);
            this.value = symbol_table[this.id].value;
            this.arity = 'literal';
            return this;
        };
        x.value = v;
        return x;
    };

    var infix = function(id, bp, led) {
        var s = symbol(id, bp);
        s.led = led || function(left) {
            this.first = left;
            this.second = expression(bp);
            this.arity = 'binary';
            return this;
        };
        return s;
    };

    var infixr = function(id, bp, led) {
        var s = symbol(id, bp);
        s.led = led || function(left) {
            this.first = left;
            this.second = expression(bp - 1);
            this.arity = 'binary';
            return this;
        };
        return s;
    };

    var assignment = function(id) {
        return infixr(id, 10, function(left) {
            if(left.id !== '.' && left.id !== '[' && left.arity !== 'name') {
                error(left, 'Bad lvalue.');
            }
            this.first = left;
            this.second = expression(9);
            this.assignment = true;
            this.arity = 'binary';
            return this;
        });
    };

    var prefix = function(id, nud) {
        var s = symbol(id);
        s.nud = nud || function() {
            scope.reserve(this);
            this.first = expression(70);
            this.arity = 'unary';
            return this;
        };
        return s;
    };

    var stmt = function(s, statementFunction) {
        var x = symbol(s);
        x.std = statementFunction || function() {
            this.arity = 'statement';
            this.id = s;
            advance();
            return this;
        };
        return x;
    };

    symbol('(end)');
    symbol('(name)');
    symbol(':');
    symbol(';');
    symbol(')');
    symbol(']');
    symbol('}');
    symbol(',');
    symbol('else');

    symbol('{%');
    symbol('{{');
    symbol('%}');
    symbol('}}');

    symbol('endfor');
    symbol('endblock');
    symbol('endwhile');
    symbol('endif');
    symbol('in');
    symbol('list');
    symbol('extends');
    symbol('local');

    constant('true', true);
    constant('false', false);
    constant('null', null);
    constant('pi', 3.141592653589793);
    constant('Object', {});
    constant('Array', []);

    symbol('(literal)').nud = itself;

    symbol('this').nud = function() {
        scope.reserve(this);
        this.arity = 'this';
        return this;
    };

    assignment('=');
    assignment('+=');
    assignment('-=');

    infix('?', 20, function(left) {
        this.first = left;
        this.second = expression(0);
        advance(':');
        this.third = expression(0);
        this.arity = 'ternary';
        return this;
    });

    infixr('&&', 30);
    infixr('||', 30);

    //infixr('===', 40);
    infixr('==', 40);
    infixr('!==', 40);
    infixr('<', 40);
    infixr('<=', 40);
    infixr('>', 40);
    infixr('>=', 40);

    infix('+', 50);
    infix('-', 50);

    infix('*', 60);
    infix('/', 60);

    infix('.', 80, function(left) {
        this.first = left;
        if(token.arity !== 'name') {
            error(token, 'Expected a property name.');
        }
        token.arity = 'literal';
        this.second = token;
        this.arity = 'binary';
        advance();
        return this;
    });

    infix('[', 80, function(left) {
        this.first = left;
        this.second = expression(0);
        this.arity = 'binary';
        advance(']');
        return this;
    });

    infix('(', 80, function(left) {
        var a = [];
        if(left.id === '.' || left.id === '[') {
            this.arity = 'ternary';
            this.first = left.first;
            this.second = left.second;
            this.third = a;
        } else {
            this.arity = 'binary';
            this.first = left;
            this.second = a;
            if((left.arity !== 'unary' || left.id !== 'function') &&
                left.arity !== 'name' && left.id !== '(' &&
                left.id !== '&&' && left.id !== '||' && left.id !== '?') {
                error(left, 'Expected a variable name.');
            }
        }
        if(token.id !== ')') {
            while(true) {
                a.push(expression(0));
                if(token.id !== ',') {
                    break;
                }
                advance(',');
            }
        }
        advance(')');
        return this;
    });

    prefix('!');
    prefix('-');
    prefix('typeof');
    prefix('async');

    prefix('(', function() {
        var e = expression(0);
        advance(')');
        return e;
    });

    prefix('function', function() {
        var a = [];
        new_scope();
        if(token.arity === 'name') {
            scope.define(token);
            this.name = token.value;
            advance();
        }
        advance('(');
        if(token.id !== ')') {
            while(true) {
                if(token.arity !== 'name') {
                    error(token, 'Expected a parameter name.');
                }
                scope.define(token);
                a.push(token);
                advance();
                if(token.id !== ',') {
                    break;
                }
                advance(',');
            }
        }
        this.first = a;
        advance(')');
        advance('{');
        this.second = statements();
        advance('}');
        this.arity = 'function';
        scope.pop();
        return this;
    });

    prefix('[', function() {
        var a = [];
        if(token.id !== ']') {
            while(true) {
                a.push(expression(0));
                if(token.id !== ',') {
                    break;
                }
                advance(',');
            }
        }
        advance(']');
        this.first = a;
        this.arity = 'unary';
        return this;
    });

    // Object literal
    prefix('{', function() {
        var a = [], n, v;
        if(token.id !== '}') {
            while(true) {
                n = token;
                if(n.arity !== 'name' && n.arity !== 'literal') {
                    error(token, 'Bad property name.');
                }
                advance();
                advance(':');
                v = expression(0);
                v.key = n.value;
                a.push(v);
                if(token.id !== ',') {
                    break;
                }
                advance(',');
            }
        }
        advance('}');
        this.first = a;
        this.arity = 'unary';
        return this;
    });

    stmt('template', function() {
        return this;
    });

    stmt('list', function() {
        metadata.isList = true;
        this.arity = 'statement';
        return this;
    });

    stmt('extends', function() {
        metadata.hasExtendsStatement = true;
        if(token.value == 'local') {
            this.value = 'localextends';
            advance();
        }
        this.first = expression(0);
        this.arity = 'statement';
        return this;
    });

    stmt('include', function() {
        metadata.hasIncludeStatement = true;
        this.first = expression(0);
        this.arity = 'statement';
        return this;
    });

    stmt('block', function() {
        metadata.hasBlocks = true;
        this.first = expression(0);
        this.second = statements('endblock');
        advance('endblock');
        this.arity = 'statement';
        return this;
    });

    stmt('var', function() {
        var a = [], n, t;
        while(true) {
            n = token;
            if(n.arity !== 'name') {
                error(n, 'Expected a new variable name.');
            }
            scope.define(n);
            advance();
            if(token.id === '=') {
                t = token;
                advance('=');
                t.first = n;
                t.second = expression(0);
                t.arity = 'binary';
                a.push(t);
            }
            if(token.id !== ',') {
                break;
            }
            advance(',');
        }
        advance(';');
        return a.length === 0 ? null : a.length === 1 ? a[0] : a;
    });

    stmt('if', function() {
        // Get the condition of the if statement
        this.first = expression(0); // statements(); // ?
        this.arity = 'statement';

        // Get the body of the if
        this.second = statements('else', 'endif');

        if(token.value == 'else') {
            advance('else');
            this.third = statements('endif');
            advance('endif');
        } else if(token.value == 'endif') {
            // Without setting this explicitly, this.third is becoming a circular reference to
            // the same `else` node. Wtf?
            this.third = null;
            advance('endif');
        } else {
            //throw new Error('Expected `endif` or `else`, but instead got `' + token.value + '`');
            error(token, 'Expected `endif` or `else`, but instead got `' + token.value + '`');
        }

        return this;
    });

    stmt('return', function() {
        if(token.id !== ';') {
            this.first = expression(0);
        }
        advance(';');
        if(token.id !== '}') {
            error(token, 'Unreachable statement.');
        }
        this.arity = 'statement';
        return this;
    });

    stmt('break', function() {
        advance(';');
        if(token.id !== '}') {
            error(token, 'Unreachable statement.');
        }
        this.arity = 'statement';
        return this;
    });

    stmt('for', function() {
        this.first = expression(0);

        if(token.value == ',') {
            advance(',');
            this.first = [this.first, expression(0)];
        }

        advance('in');
        this.second = expression(0);
        this.third = statements('endfor');
        advance('endfor');
        this.arity = 'statement';
        return this;
    });

    stmt('while', function() {
        advance('(');
        this.first = expression(0);
        advance(')');
        this.second = block();
        this.arity = 'statement';
        return this;
    });

    return function(source) {
        tokens = source;
        tokenIndex = 0;
        new_scope();
        advance();
        var stmts = [],
            next;
        while((next = statements())) {
            stmts.push(next);
        }
        scope.pop();
        return {
            ast: stmts,
            metadata: metadata
        };
    };
}

function parse(tokens) {
    return makeParser()(tokens);
}

var parser = module.exports;
parser.makeParser = makeParser;
parser.parse = parse;
