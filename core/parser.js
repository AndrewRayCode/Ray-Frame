// http://javascript.crockford.com/tdop/index.html
function tokenize(input) {
    var c,                          // The current character.
        from,                       // The index of the start of the token.
        i = 0,                      // The index of the current character.
        length = input.length,
        n,                          // The number value.
        q,                          // The quote character.
        buffer,                     // The string value.
        prefix,
        suffix,
        inTag = false,
        peek,
        state = 'template',
        tokens = [];                // An array to hold the results.

    var startStates = {
        '{%': 'control',
        '{{': 'plip'
    };
    var stateClosers = {
        control: '%}',
        plip: '}}'
    };

    // Make a token object.
    var make = function(type, value) {
        var whichValue;

        if(1 in arguments) {
            whichValue = value;
        } else {
            whichValue = buffer;
            buffer = '';
        }
        return {
            type: type,
            value: whichValue,
            from: from,
            inTag: inTag,
            to: i
        };
    };

    var advance = function(jump) {
        i += (jump || 1);
        c = input.charAt(i);
        peek = input.charAt(i + 1);
        return c;
    }

    // If prefix and suffix strings are not provided, supply defaults.
    if(typeof prefix !== 'string') {
        prefix = '<>+-&%';
    }
    if(typeof suffix !== 'string') {
        suffix = '=>&:';
    }

    // Loop through input text, one character at a time.
    c = input.charAt(i);

    for(var startState in startStates) {
        if(input.indexOf(startState) === 0) {
            state = startStates[startState];
            advance(startState.length);
            break;
        }
    }

    while(c) {
        from = i;

        if(state == 'template') {
            buffer = '';
            for(;;) {
                // Look for control starts
                if(c == '{' && (peek == '{' || peek == '%')) {
                    tokens.push(make('template'));
                    if(peek == '{') {
                        state = 'plip';
                    } else if(peek == '%') {
                        state = 'control';
                    }

                    // Jump past the control
                    advance(2);

                    break;
                } else {
                    // Look for HTML tags and note when we are between angle brackets
                    if(c == '<' && peek > 'a' && peek <= 'z') {
                        inTag = true;
                    } else if(c == '\n' || c == '\r' || c == '>') {
                        inTag = false;
                    }
                }

                buffer += c;
                advance();

                if(i >= length) {
                    tokens.push(make('template'));
                    break;
                }
            }
        }

        if(state == 'plip') {
            buffer = '';
            for(;;) {

                // Check for end of plip or : divider
                if(c == ':' || (c == '}' && peek == '}')) {

                    // Check for plip assignment
                    if(buffer.indexOf('=') > -1) {
                        var pieces = buffer.split('=');

                        if(pieces.length != 2 || !pieces[0].length || !pieces[1].length) {
                            throw new Error('Invaid plip piece assignment ' + buffer + ', must follow \'key=value\' syntax');
                        }
                        tokens.push(make('plipPieceAssign', buffer.split('=')));

                    // Check for bad plip
                    } else if(buffer.trim() === '') {
                        throw new Error('Invliad plip syntax: \'' + buffer + '\'');

                    // Save plip
                    } else {
                        tokens.push(make('plipPiece'));
                    }

                    if(c != ':') {
                        state = 'template';
                        advance(2);
                        break;
                    } else {
                        buffer = '';
                        advance();
                    }
                // Scan plip info and skip whitespace
                } else {
                    if(c >= ' ') {
                        buffer += c;
                    }
                    advance();
                }

                if(i >= length) {
                    throw new Error('Unterimnated ' + state + ' statement found, expected \'' + stateClosers[state] + '\' before end of file.');
                }
            }
        }

        if(state == 'control') {
            if(c == '%' && peek == '}') {
                state = 'template';
                advance(2);
            } else {
                // Ignore whitespace.
                if(c <= ' ') {
                    advance();
                // name.
                } else if((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
                    buffer = c;
                    i += 1;
                    for (;;) {
                        c = input.charAt(i);
                        if((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                                (c >= '0' && c <= '9') || c === '_') {
                            buffer += c;
                            i += 1;
                        } else {
                            break;
                        }
                    }
                    tokens.push(make('name'));

                // number.

                // A number cannot start with a decimal point. It must start with a digit,
                // possibly '0'.
                } else if(c >= '0' && c <= '9') {
                    buffer = c;

                    // Look for more digits.
                    for (;;) {
                        advance();
                        if(c < '0' || c > '9') {
                            break;
                        }
                        buffer += c;
                    }

                    // Look for a decimal fraction part.
                    if(c === '.') {
                        buffer += c;
                        for (;;) {
                            advance();
                            if(c < '0' || c > '9') {
                                break;
                            }
                            buffer += c;
                        }
                    }

                    // Look for an exponent part.
                    if(c === 'e' || c === 'E') {
                        buffer += c;
                        advance();
                        if(c === '-' || c === '+') {
                            buffer += c;
                            advance();
                        }
                        if(c < '0' || c > '9') {
                            make('number').error("Bad exponent");
                        }
                        do {
                            buffer += c;
                            advance();
                        } while(c >= '0' && c <= '9');
                    }

                    // Make sure the next character is not a letter.
                    if(c >= 'a' && c <= 'z') {
                        buffer += c;
                        i += 1;
                        make('number').error("Bad number");
                    }

                    // Convert the string value to a number. If it is finite, then it is a good
                    // token.
                    n = +buffer;
                    if(isFinite(n)) {
                        tokens.push(make('number', n));
                    } else {
                        make('number').error("Bad number");
                    }

                // string
                } else if(c === "'" || c === '"') {
                    buffer = '';
                    q = c;
                    i += 1;
                    for (;;) {
                        c = input.charAt(i);
                        if(c < ' ') {
                            make('string').error(c === '\n' || c === '\r' || c === '' ?
                                    "Unterminated string." :
                                    "Control character in string.", make(''));
                        }

                        // Look for the closing quote.
                        if(c === q) {
                            break;
                        }

                        // Look for escapement
                        if(c === '\\') {
                            i += 1;
                            if(i >= length) {
                                make('string').error("Unterminated string");
                            }
                            c = input.charAt(i);
                            switch(c) {
                                case 'b':
                                    c = '\b';
                                    break;
                                case 'f':
                                    c = '\f';
                                    break;
                                case 'n':
                                    c = '\n';
                                    break;
                                case 'r':
                                    c = '\r';
                                    break;
                                case 't':
                                    c = '\t';
                                    break;
                                case 'u':
                                    if(i >= length) {
                                        make('string').error("Unterminated string");
                                    }
                                    c = parseInt(input.substr(i + 1, 4), 16);
                                    if(!isFinite(c) || c < 0) {
                                        make('string').error("Unterminated string");
                                    }
                                    c = String.fromCharCode(c);
                                    i += 4;
                                    break;
                            }
                        }
                        buffer += c;
                        i += 1;
                    }
                    tokens.push(make('string'));
                    advance();

                // comment.
                } else if(c === '/' && peek === '/') {
                    for (;;) {
                        advance();
                        if(c === '\n' || c === '\r' || c === '') {
                            break;
                        }
                    }

                // combining
                } else if(prefix.indexOf(c) >= 0) {
                    buffer = c;
                    while(true) {
                        advance();
                        if(i >= length || suffix.indexOf(c) < 0) {
                            break;
                        }
                        buffer += c;
                    }
                    tokens.push(make('operator'));

                // single-character operator
                } else {
                    tokens.push(make('operator', c));
                    c = advance();
                }
            }
        }
    }
    
    if(state != 'template') {
        throw new Error('Unterimnated ' + state + ' statement found, expected \'' + stateClosers[state] + '\' before end of file.');
    }

    return tokens;
}

function parse(tokens) {

}

console.log(tokenize('<div>{% if(cheese == 3) {} %} {{ plumb:poop=cheese:barf }}</div>'));
