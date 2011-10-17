// http://javascript.crockford.com/tdop/index.html
function error(token, message) {
    token.name = 'SyntaxError';
    token.message = message;
    throw token;
}

function makeParser() {
    var scope,
        symbol_table = {},
        token,
        tokens,
        token_nr,
        state = 'template';

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
        var a, o, t, v;
        if(id && token.id !== id) {
            if(id == ';' && token.id != '%}') {
                error(token, 'Expected \'' + id + '\'.');
            }
        }
        if(token_nr >= tokens.length) {
            token = symbol_table['(end)'];
            return;
        }
        t = tokens[token_nr];
        token_nr += 1;
        v = t.value;
        a = t.type;
        if(state == 'control') {
            if(a === 'name') {
                o = scope.find(v);
            } else if(a === 'operator') {
                o = symbol_table[v];
                if(!o) {
                    error(t, 'Unknown operator.');
                }
            } else if(a === 'string' || a ===  'number') {
                o = symbol_table['(literal)'];
                a = 'literal';
            } else if(a == 'controller') {
                o = symbol_table[v];
                state = 'template';
            } else {
                error(t, 'Unexpected token.');
            }
        } else if(state == 'plip') {
            if(a == 'plip') {
                o = symbol_table[v];
                state = 'template';
            } else {
                o = symbol_table['(literal)'];
            }
        } else if(state == 'template') {
            if(a == 'controller') {
                state = 'control';
                o = symbol_table[v];
            } else if(a == 'plip') {
                state = 'plip';
                o = symbol_table[v];
            } else {
                o = symbol_table[a];
            }
        }
        token = Object.create(o);
        token.from  = t.from;
        token.to    = t.to;
        token.value = v;
        token.arity = a;
        return token;
    };

    var expression = function(rbp) {
        var left;
        var t = token;
        advance();
        left = t.nud();
        while(rbp < token.lbp) {
            t = token;
            advance();
            left = t.led(left);
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
        v = expression(0);
        if(!v.assignment && v.id !== '(') {
            error(v, 'Bad expression statement.');
        }
        advance(';');
        return v;
    };

    var statements = function() {
        var a = [], s;
        while(true) {
            if(token.id === '}' || token.id === '(end)' || token.id == '%}') {
                break;
            }
            s = statement();
            if(s) {
                a.push(s);
            }
        }
        return a.length === 0 ? null : a.length === 1 ? a[0] : a;
    };

    var block = function() {
        var t = token;
        advance('{');
        return t.std();
    };

    var original_symbol = {
        nud: function() {
            error(this, 'Undefined symbol: ' + this.value);
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

    var stmt = function(s, f) {
        var x = symbol(s);
        x.std = f;
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

    symbol('%}');
    symbol('}}');

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

    infixr('===', 40);
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

    stmt('{', function () {
        new_scope();
        var a = statements();
        advance('}');
        scope.pop();
        return a;
    }); 

    stmt('{%', function() {
        var a = statements();
        advance('%}');
        return a;
    });

    stmt('{{', function() {
        var lastKey;
        if(token.arity != 'name') {
            error(token, 'Expected a plip name.');
        }
        this.plipName = token.value;
        this.plipValues = {};

        while(true) {
            advance();
            if(token.value == '=') {
                advance();
                if(token.arity != 'name') {
                    error(token, 'Expected a plip assignment value');
                }
                this.plipValues[lastKey] = token.value;
                advance();
            } else if(token.arity == 'name') {
                this.plipValues[(lastKey = token.value)] = null;
            } else if(token.value != ':') {
                break;
            }
        }
        delete this.value;
        advance('}}');
        return this;
    });

    stmt('template', function() {
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
        advance('(');
        this.first = expression(0);
        advance(')');
        this.second = block();
        if(token.id === 'else') {
            scope.reserve(token);
            advance('else');
            this.third = token.id === 'if' ? statement() : block();
        } else {
            this.third = null;
        }
        this.arity = 'statement';
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
        token_nr = 0;
        new_scope();
        advance();
        var s = statements();
        advance('(end)');
        scope.pop();
        return s;
    };
}

function parse(tokens) {
    return makeParser()(tokens);
}

var parser = module.exports;
parser.makeParser = makeParser;
parser.parse = parse;
