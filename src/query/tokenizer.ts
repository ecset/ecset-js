import { parseJSON } from '@odgn/utils';

const MODE_IDLE = 0;
const MODE_COMMENT = 1 << 0;
const MODE_MULTI_COMMENT = 1 << 1;
const MODE_MULTI_QUOTE = 1 << 2;
const MODE_QUOTE = 1 << 3;
const MODE_MAYBE_QUOTE = 1 << 4;
const MODE_VALUE = 1 << 5;

function set(flag, val) {
    return flag | val;
}
function isSet(flag, val) {
    return (flag & val) === val;
}
function unset(flag, val) {
    return flag & ~val;
}

interface Context {
    buffer: string;
    offset: number;
    pos: number;
    length: number;
    output: any[];
    line: number;
    markPosition: number;
    linePosition: number;
    charBuffer: string[];
    mode: number;
    endChar: string;
    mapCount: number;
    expectKey: boolean;
}

export interface TokenizeOptions {
    returnValues?: boolean;
}

/**
 *
 * @param data
 * @param options
 */
export function tokenizeString(data: string, options: TokenizeOptions = {}) {
    const returnValues = options.returnValues ?? false;
    let context = createContext();

    if (!data.endsWith('\n')) {
        data = data + '\n';
    }

    context = tokenize(context, data);

    return returnValues ? context.output.map((e) => e[0]) : context.output;
}

/**
 * Entry point for parsing a new string
 */
export function tokenize(context: Context, input: string): Context {
    context = context || createContext();
    context.length = context.pos + input.length;

    while (context.pos < context.length) {
        context = process(context, input);
    }

    return context;
}

function process(context: Context, input: string): Context {
    let {
        pos,
        length,
        offset,
        mode,
        markPosition,
        output,
        endChar,
        mapCount,
        expectKey,
        buffer,
        charBuffer,
        line,
        linePosition = 0,
    } = context;

    let cpos = 0;
    for (pos; pos < length; cpos++, pos++) {
        let char = input.charAt(cpos);
        linePosition++;

        // console.log('>', pos, length, char, markPosition, linePosition, modeToString(mode), JSON.stringify(buffer) );

        charBuffer[2] = charBuffer[1];
        charBuffer[1] = charBuffer[0];
        charBuffer[0] = char;

        const isNewline = char === '\n';

        if (isSet(mode, MODE_MAYBE_QUOTE)) {
            // console.log('maybequote', char, charBuffer, char !== "'", charBuffer[1] === "'" );
            let clear = false;
            if (char === '*' || char === '/' || char === "'") {
                if (char === '*' && charBuffer[1] === '/') {
                    mode = set(mode, MODE_MULTI_COMMENT);
                    clear = true;
                } else if (char === '/' && charBuffer[1] === '/') {
                    mode = set(mode, MODE_COMMENT);
                    clear = true;
                } else if (char === "'" && charBuffer[1] === "'" && charBuffer[2] === "'") {
                    mode = set(mode, MODE_MULTI_QUOTE);

                    offset = linePosition;
                    clear = true;
                }
            } else if (char !== "'" && charBuffer[1] === "'" && charBuffer[2] === "'") {
                output.push(['', markPosition, line]);
                clear = true;
            } else if (char !== "'" && charBuffer[1] === "'") {
                mode = set(mode, MODE_QUOTE);
                mode = unset(mode, MODE_MAYBE_QUOTE);
                offset = linePosition;
                markPosition = pos;
                endChar = "'";
                buffer = char;
                continue;
            } else {
                // console.log('start val', {char, pos, mapCount, expectKey, last:charBuffer[1]}, buffer);
                mode = set(mode, MODE_VALUE);
                mode = unset(mode, MODE_MAYBE_QUOTE);
                endChar = char === '"' ? char : '';

                offset = linePosition;
                if (mapCount > 0 && charBuffer[1] === ':' && expectKey) {
                    //&& (char === '"' || char === "'")) {
                    // console.log(`map delim (${char}) (${buffer})`, {expectKey, mapCount});
                    buffer = '';
                    markPosition++;
                    expectKey = !expectKey;
                } else if (mapCount > 0) {
                    // console.log(`nope delim (${char}) (${buffer})`, {expectKey, mapCount});
                }
            }

            if (clear) {
                mode = unset(mode, MODE_MAYBE_QUOTE);
                // mode = MODE_IDLE;
                // maybeWithinQuote = false;
                buffer = '';
                continue;
            }

            if (isNewline || char === ' ') {
                // console.log('endof', { markPosition, mapCount }, buffer);
                if (mapCount === 0) {
                    output.push([parseValue(buffer.trimEnd()), markPosition, line]);
                }
                mode = unset(mode, MODE_MULTI_QUOTE | MODE_VALUE);
                // maybeWithinQuote = false;
                buffer = '';
            } else {
                if (char === '{') {
                    mapCount++;
                    expectKey = true;
                    // console.log('inc', {mapCount, char, pos})
                } else if (char === '}') {
                    mapCount--;
                    expectKey = true;
                    // console.log('dec', {mapCount, char, pos})
                }
                switch (char) {
                    // unquoted strings contain everything up to the next line!
                    case '{':
                    case '}':
                    case '[':
                    case ']':
                    case ':':
                    case ',':
                        // console.log('but what', `(${char})`, `(${buffer})`, {mode, mapCount});
                        if (char !== ':' && buffer.length > 0) {
                            output.push([parseValue(buffer.trimEnd()), markPosition, line]);
                        }
                        mode = unset(mode, MODE_MULTI_QUOTE | MODE_VALUE);
                        // maybeWithinQuote = false;
                        buffer = '';

                        if (char !== ',') {
                            output.push([char, pos, line]);
                        }
                        break;
                }
            }
        } else if (mode === MODE_MULTI_QUOTE) {
            // console.log('mode multiquote', pos, char, isNewline);
            // check for end quote
            if (char == "'" && charBuffer[1] == "'" && charBuffer[2] == "'") {
                // mode = MODE_IDLE;
                mode = unset(mode, MODE_MULTI_QUOTE);

                output.push([trimMultiQuote(buffer, offset), markPosition, line]);
                buffer = '';
            }
        } else if (isSet(mode, MODE_VALUE)) {
            let ended = false;
            if (endChar.length > 0) {
                ended = endChar.indexOf(char) !== -1;
                if (ended) {
                    buffer = buffer + char;
                }
            } else {
                ended = char === ' ' || isNewline || char === ',' || char === ':' || char === ']' || char === '}';
            }
            if (ended) {
                // console.log('end value', {mode, pos, char, endChar, mapCount}, buffer);

                const value = parseValue(buffer.trimEnd());
                // console.log('end val', {char, value, pos}, value );
                output.push([value, markPosition, line]);
                mode = unset(mode, MODE_VALUE);
                expectKey = true;
                if (char === ']' || char === '}') {
                    // output.push([ char,markPosition,line]);
                    cpos -= 1;
                    pos -= 1;
                    linePosition -= 1;
                }
                buffer = '';
                endChar = '';
            }
        } else if (isSet(mode, MODE_QUOTE)) {
            // console.log('mode quote', pos, char, isNewline);
            if (endChar.indexOf(char) !== -1) {
                output.push([buffer, markPosition, line]);
                mode = unset(mode, MODE_QUOTE);
                buffer = '';
                endChar = '';
                expectKey = true;
            }
        } else if (isSet(mode, MODE_MULTI_COMMENT)) {
            if (char == '/' && charBuffer[1] == '*') {
                // withinMultiComment = false;
                mode = unset(mode, MODE_MULTI_COMMENT);
            }
        } else if (isSet(mode, MODE_COMMENT)) {
            if (isNewline) {
                mode = unset(mode, MODE_COMMENT);
                // withinComment = false;
            }
        } else {
            // console.log('hmm', mode, char);
            if (char === '{') {
                mapCount++;
                expectKey = true;
                // console.log('inc', {mapCount, char, pos})
            } else if (char === '}') {
                mapCount--;
                expectKey = true;
                // console.log('dec', {mapCount, char, pos})
            }
            switch (char) {
                case '{':
                case '}':
                case '[':
                case ']':
                    output.push([char, pos, line]);
                    break;
                // case ':':
                case ',':
                    break;
                case ' ':
                case '\n':
                    break;
                case '#':
                    mode = set(mode, MODE_COMMENT);
                    // withinComment = true;
                    break;
                case '"':
                    mode = set(mode, MODE_QUOTE);
                    // withinQuote = true;
                    // console.log('start quote', {char,pos});
                    markPosition = pos;
                    char = '';
                    endChar = '"';
                    break;
                case '~':
                    mode = set(mode, MODE_QUOTE);
                    markPosition = pos;
                    char = '~';
                    endChar = ' \n';
                    break;
                default:
                    mode = set(mode, MODE_MAYBE_QUOTE);
                    markPosition = pos;
                    break;
            }
        }

        if (isNewline) {
            line++;
            linePosition = 0;
        }

        if (
            isSet(mode, MODE_QUOTE) ||
            isSet(mode, MODE_VALUE) ||
            // || isSet(mode, MODE_MAYBE_VALUE)
            isSet(mode, MODE_MAYBE_QUOTE) ||
            isSet(mode, MODE_MULTI_QUOTE)
        ) {
            buffer = buffer + char;
        }
    }

    return {
        ...context,
        pos,
        buffer,
        endChar,
        mapCount,
        expectKey,
        offset,
        markPosition,
        mode,
        charBuffer,
        output,
        line,
        linePosition,
    };
}

function trimMultiQuote(buffer: string, headerOffset: number) {
    // trim all whitespace up to the first character
    buffer = buffer.substring(0, buffer.length - 2).trimStart();
    let len,
        ii,
        lines = buffer.split('\n');

    for (ii = lines.length - 1; ii >= 0; ii--) {
        lines[ii] = trimLeftMax(lines[ii], headerOffset - 2);
    }

    buffer = lines.join('\n');

    return buffer;
}

function createContext(): Context {
    return {
        buffer: '',
        pos: 0,
        offset: 0,
        length: 0,
        output: [],
        line: 0,
        mode: MODE_IDLE,
        linePosition: 0,
        markPosition: 0,
        charBuffer: ['', '', ''],
        endChar: '',
        mapCount: 0,
        expectKey: true,
    };
}

/**
 * Trims whitespace from the left side of a string up to the offset
 * @param {*} str
 * @param {*} offset
 */
function trimLeftMax(str: string, offset: number) {
    let ws = /\s/,
        ii = 0;
    while (ii < offset && ws.test(str.charAt(ii++)));
    return str.substring(ii - 1);
}

function parseValue(str: string) {
    return parseJSON(str, str);
}
