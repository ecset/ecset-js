import { deepExtend } from '@odgn/utils';
import { isInteger, isPromise, isString } from '@odgn/utils';
import { toInteger } from '@odgn/utils';
import { createLog } from '../util/log';
import { getComponentDefsFromBitField, stackToString, unpackStackValueR } from './util';
import { EntityId, getEntityId } from '../entity';
import { ComponentDefId, ComponentDef } from '../component_def';
import { BitField, create as createBitField, toValues as bfToValues } from '@odgn/utils/bitfield';
import {
    StackValue,
    WordFn,
    SType,
    StackError,
    InstResult,
    AsyncInstResult,
    WordSpec,
    WordEntry,
    Words,
    WordArgs,
} from './types';
import { EntitySet } from '../entity_set';
const Log = createLog('QueryStack');

export interface CloneOptions {
    items?: boolean;
    words?: boolean;
}

export const ActiveMode = {
    Active: 0,
    Leave: 1,
    Break: 2,
    Return: 3,
} as const;
type ActiveMode = typeof ActiveMode[keyof typeof ActiveMode];

let stackId = 0;

interface QueryStackInst {
    id: number;
    items: StackValue[];
    words: Words;
    isUDWordsActive: boolean;
    isEscapeActive: boolean;
    isActive: boolean;
}

function createInst(): QueryStackInst {
    return {
        id: ++stackId,
        items: [],
        words: {},
        isUDWordsActive: true,
        isEscapeActive: true,
        isActive: true,
    };
}

export class QueryStack {
    es?: EntitySet;

    _idx = 0;
    _stacks: QueryStackInst[];

    // _udWords = new WeakMap();
    _udWords: { [key: string]: any } = {};

    // used by words for temporary storage
    scratch: { [key: string]: any } = {};

    debug = false;

    ignoreUndefinedUDWord = false;

    constructor(stack?: QueryStack) {
        this._stacks = [createInst()];
    }

    get inst(): QueryStackInst {
        return this._stacks[this._idx];
    }

    get words(): Words {
        return this._stacks[this._idx].words;
    }
    // get udWords(): { [key:string]: any } {
    //     return this._stacks[ this._idx ].udWords;
    // }
    get items(): StackValue[] {
        return this._stacks[this._idx].items;
    }

    set isUDWordsActive(val: boolean) {
        this._stacks[this._idx].isUDWordsActive = val;
    }
    get isUDWordsActive() {
        return this._stacks[this._idx].isUDWordsActive;
    }

    set isEscapeActive(val: boolean) {
        this._stacks[this._idx].isEscapeActive = val;
    }
    get isEscapeActive() {
        return this._stacks[this._idx].isEscapeActive;
    }

    set isActive(val: boolean) {
        this._stacks[this._idx].isActive = val;
    }

    get isActive() {
        return this._stacks[this._idx].isActive;
    }

    setItems(items: StackValue[]): QueryStack {
        this._stacks[this._idx].items = items;
        return this;
    }

    get size(): number {
        return this._stacks[this._idx].items.length;
    }

    getUDValue(word: string) {
        const value = this.getUDWord(word);
        return unpackStackValueR(value);
    }

    peek(offset = 0): StackValue {
        const items = this.items;
        const length = items.length;
        const idx = length - 1 - offset;
        // if (idx < 0 || length === 0) {
        //     // console.log('[pop]', this);
        //     throw new StackError(`stack underflow ${offset} / ${length}`);
        // }

        return items[idx];
    }

    clear(clearItems = true, clearWords = false, reset = true): QueryStack {
        if (reset) {
            this._idx = 0;
            this._stacks = this._stacks.splice(0, 1);
        }
        if (clearItems) {
            this._stacks[this._idx].items = [];
        }
        if (clearWords) {
            this._stacks[this._idx].words = {};
        }
        if (reset) {
            this.isActive = true;
            this.isEscapeActive = true;
            this.isUDWordsActive = true;
            this._udWords = {};
        }
        return this;
    }

    focus(): QueryStack {
        this._idx = this._stacks.length - 1;
        return this;
    }

    focusParent(): QueryStack {
        this._idx = this._idx > 1 ? this._idx - 1 : 0;
        return this;
    }

    setChild(stack?: QueryStack): QueryStack {
        const sub = createInst();
        if (stack !== undefined) {
            sub.words = deepExtend(stack.words);
        }
        this._stacks.push(sub);
        this._idx = this._stacks.length - 1;

        return this;
    }

    restoreParent(): QueryStack {
        if (this._stacks.length <= 1) {
            return this;
        }

        this._stacks.pop();
        this._idx = this._stacks.length - 1;

        return this;
    }

    /**
     * Pushes a stack value onto the stack
     */
    async push(input: any | StackValue, options?: PushOptions): Promise<StackValue> {
        let value: StackValue;
        let handler: WordFn | StackValue;
        // const debug = options.debug;
        // const ticket = options.ticket;

        value = isStackValue(input) ? input : [SType.Value, input];
        let [type, word] = value;

        // if( options.debug ) Log.debug('[push]', 'pre', this.isActive, value);

        if (this.isEscapeActive) {
            if (word == '@!') {
                this.isActive = false;
                // this.setActive(false, ActiveMode.Return, word);
            } else if (word == '@>') {
                this.isActive = true;
                // this.setActive(true, ActiveMode.Active, word);
                return value;
            }
        }

        // if( options.debug ) Log.debug('[push]', 'post', this.isActive, value);

        if (this.isActive === false) {
            // Log.debug('[push]', 'inactive stack');
            return undefined;
        }

        // let doPush = true;
        const debug = options?.debug ?? false;
        const evalEscape = options?.evalEscape ?? false;

        if (type === SType.Value && isString(word)) {
            const len = word.length;
            let evalWord = true;

            if (len > 1 && word.charAt(0) === '~') {
                const sigil = word.charAt(1);
                const sep = word.charAt(2);
                const end = word.lastIndexOf(sep);
                const flags = word.substring(end + 1);
                const sigilV = word.substring(3, end);

                if (sigil === 'r') {
                    const regex = new RegExp(sigilV, flags);
                    // Log.debug('[push]', 'regex', sigilV, regex);
                    value = [SType.Regex, regex];
                } else if (sigil === 'd') {
                    value = [SType.DateTime, sigilV == '' ? new Date() : new Date(sigilV)];
                }
            }

            // escape char for values which might otherwise get processed as words
            if (len > 1 && word.charAt(0) === '*') {
                word = word.substring(1);
                value = [SType.Value, word] as any;
                evalWord = evalEscape; // false;

                // if( debug ) Log.debug('[push]', value, 'escaped');
            }

            if (evalWord) {
                // save the current stack
                const stackIndex = this._idx;

                if (len > 1) {
                    // words beginning with ^ cause the stack focus to move up
                    while (word.charAt(0) === '^') {
                        this.focusParent();
                        word = word.substring(1);
                        value = [type, word];
                    }
                }

                // words beginning with $ refer to offsets on the root stack if they are integers,
                // or user defined words
                const pr = word.charAt(0);
                if ((len > 1 && pr === '$') || (len > 1 && pr === '%')) {
                    const sub = word.substring(1);
                    if (isInteger(sub)) {
                        const idx = toInteger(sub);

                        value = pr === '$' ? this.pop(idx) : this.peek(idx);
                    } else if (this.isUDWordsActive) {
                        handler = this.getUDWord(sub);
                        if (handler === undefined && !this.ignoreUndefinedUDWord) {
                            handler = [SType.Value, false];
                        }
                    }
                } else {
                    handler = this.getWord(value);
                }

                // restore back to original index
                this._idx = stackIndex;
            }
        }

        // if( debug ) Log.debug('[push]', 'what', {value,handler});
        if (handler !== undefined) {
            try {
                if (isStackValue(handler)) {
                    value = handler as any;
                    if (value[0] === SType.Word) {
                        await this.pushValues(value[1]);
                        value = undefined;
                    }
                } else {
                    const result = (handler as WordFn)(this, value);
                    value = isPromise(result) ? await result : (result as InstResult);
                }
            } catch (err) {
                if (err instanceof StackError) {
                    throw err;
                }
                const e = new StackError(`${err.message}`);
                e.original = err;
                e.stack =
                    e.stack.split('\n').slice(0, 2).join('\n') + '\n' + [...new Set(err.stack?.split('\n'))].join('\n');

                Log.debug('[push][error]', { value, handler });
                // Log.debug('[push][error]', this);
                throw e;
            }
        }

        if (value !== undefined) {
            this.items.push(value);
        }
        // if( debug ) Log.debug('[push]', word, this.toString() );
        // Log.debug('[push]', word, value, handler, this.isActive );
        // Log.debug('[push]', this.items );

        return value;
    }

    /**
     * Pushes a value onto the stack without processing it
     *
     * @param value
     */
    pushRaw(value: StackValue): QueryStack {
        const stack = this; //.focus();
        // stack.items = [...stack.items, value];
        stack.items.push(value);
        return stack;
    }

    /**
     * Push multiple values onto the stack
     *
     * @param values
     * @param options
     */
    async pushValues(values: StackValue[], options: PushOptions = {}): Promise<number> {
        let count = 0;
        // record pushed values so we can report errors better
        const pushed = [];

        try {
            // if( options.debug ){ console.log('[pushValues]', values)}
            for (const value of values) {
                // if( options.debug ){ console.log('[pushValues]', value)}
                await this.push(value, options);
                count++;
                pushed.push(value);
            }
        } catch (err) {
            // if( err instanceof StackError ){
            //     throw err;
            // }
            const dump = stackToString(this, true, pushed.slice(1).slice(-5));
            let msg = err.message;
            if (msg.indexOf(': (') == -1) {
                msg = `${err.message}: (${dump})`;
            } else {
                throw err;
            }
            const e = new StackError(msg);
            // let e = new StackError(`${err.message}: (${pushed.slice(1).slice(-5).join(' ')})`);
            e.original = err;
            e.stack =
                e.stack.split('\n').slice(0, 2).join('\n') +
                '\n' +
                // + err.stack;
                [...new Set(err.stack?.split('\n'))].join('\n');
            throw e;
        }

        return count;
        // return ovalues;
    }

    popValue(offset = 0, recursive = true): any {
        const sv = this.pop(offset);
        return sv === undefined ? undefined : recursive ? unpackStackValueR(sv) : sv[1];
    }

    /**
     *
     * @param offset
     */
    pop(offset = 0): StackValue {
        // const stack = this; //this.focus();

        const length = this.items.length;
        const idx = length - 1 - offset;
        if (idx < 0 || length === 0) {
            // console.log('[pop]', this);
            throw new StackError('stack underflow');
        }
        const value = this.items[idx];
        let items;

        if (offset > 0) {
            // Log.debug('[pop]', idx, value );
            items = this.items.filter((val, ii) => idx !== ii);
            // return [{...stack, items }, value];
        } else {
            items = this.items.slice(0, -1);
        }
        this.setItems(items); // = items;
        return value;
    }

    /**
     * Pops values from the stack while the type matches
     *
     * @param stack
     * @param type
     */
    popOfType(...types: SType[]): StackValue[] {
        // const stack = this; //this.focus();
        const length = this.items.length;
        if (length === 0) {
            return [];
        }

        const results = [];
        let ii = length - 1;

        for (ii; ii >= 0; ii--) {
            const value = this.items[ii];
            if (types.indexOf(value[0] as SType) === -1) {
                break;
            }
            results.push(value);
        }

        // cut the stack down to size
        this.setItems(this.items.slice(0, ii + 1));

        return results;
    }

    addUDWord(word: string, val: any): QueryStack {
        // console.log('[addUDWord]', this._idx, word, val );
        // this.udWords[word] = val;
        this._udWords[word] = val;
        // this._udWords.set(word, val);
        // return this.addWords([[word,val]], true);
        return this;
    }

    getUDWord(word: string) {
        return this._udWords[word];
    }

    /**
     * Adds a word function to the stack
     *
     * @param words
     * @param replace
     * @returns
     */
    addWords(words: WordSpec[], replace = false): QueryStack {
        for (const spec of words) {
            const [word, fn, ...args] = spec;

            let patterns = replace ? [] : this.words[word] || [];

            const existing = patterns.findIndex((p) => matchWordArgs(args, p));

            // if the word pattern exists, then replace it
            if (existing !== -1) {
                patterns.splice(existing, 1, [fn, args] as WordEntry);
            } else {
                // otherwise add it
                patterns = [...patterns, [fn, args]] as WordEntry[];
            }

            this.words[word] = patterns;
        }

        return this;
    }

    /**
     *
     * @param word
     * @param val
     * @param replace
     * @returns
     */
    addWord(word: string, val: WordFn): QueryStack {
        return this.addWords([[word, val]]);

        // let patterns = replace ? [] : this.words[word] || [];
        // patterns = [...patterns, [val] ] as WordEntry[];
        // this.words[word] = patterns;
        // return this;
    }

    getWord(value: StackValue): WordFn | undefined {
        // const [type,word] = value;
        if (value[0] !== SType.Value || !isString(value[1])) {
            return undefined;
        }
        const wval = value[1];

        const patterns = this.words[wval];
        if (patterns === undefined) {
            return undefined;
        }
        const pattern = patterns.find((pat) => {
            const [, args] = pat;

            return matchStack(this.items, args) ? pat : undefined;

            // Log.debug('[getWord]', 'match', `'${wval}'`, args, stack.items );
        });
        // Log.debug('[getWord]', value, wval, pattern);
        if (pattern !== undefined) {
            return pattern[0];
        }

        // Log.debug('[getWord]', 'match', `'${wval}'`, patterns.map(p => p.slice(1)));
        Log.debug('[getWord]', 'match', value);
        Log.debug('[getWord]', 'match', `'${wval}'`, stackToString(this));
        throw new StackError(`invalid params for ${wval}`);
    }

    // clone<QS extends QueryStack>(stack: QS, options:CloneOptions = {}): QS {
    clone(options: CloneOptions = {}): QueryStack {
        const result = new QueryStack();

        // if (options.items ?? true) {
        //     result.items = deepExtend(this.items);
        // }
        // if (options.words ?? true) {
        //     result.words = deepExtend(this.words);
        // }

        return result;
    }

    /**
     *
     */
    findWithIndex(type: SType): [number, StackValue] {
        const stack = this; // this.focus();
        for (let ii = stack.items.length - 1; ii >= 0; ii--) {
            const item = stack.items[ii];
            if (type === item[0]) {
                // Log.debug('[findWithIndex]', 'found', item, ii );
                return [ii, item];
            }
        }
        return [-1, undefined];
    }

    //  findWithIndexV(stack: QueryStack, type: SType): [number, any] {
    //     let [index, [_, value]] = findWithIndex(stack, type);
    //     if (index === -1) {
    //         throw new Error(`type ${type} missing on stack`);
    //     }
    //     return [index, value];
    // }

    /**
     * Returns the first value of type from the stack
     *
     * @param stack
     * @param type
     */
    findV(type: SType): any {
        const stack = this; // this.focus();
        const [_, value] = stack.findWithIndex(type);
        return value ? value[1] : undefined;
    }
    find(type: SType): StackValue {
        const stack = this; //this.focus();
        const [_, value] = stack.findWithIndex(type);
        return value;
    }

    /**
     * Conditionally pops a bitfield from the stack if it is present.
     * If it is, then either defs or dids are returned as a result.
     *
     * @param asObj
     */
    popBitField<CD extends ComponentDef>(asObj = true): CD[] | ComponentDefId[] {
        const stack = this; //this.focus();
        const { es } = stack;
        let val;
        let dids: ComponentDefId[];
        let defs: CD[];
        val = stack.peek();

        const [type, bf] = val;

        if (type === SType.BitField || (type === SType.Value && bf === 'all')) {
            stack.pop();
            const result = getComponentDefsFromBitField(es, bf, asObj === false);
            return asObj ? (result as CD[]) : (result as ComponentDefId[]);
        }

        return undefined;
    }

    popBitFieldOpt(): BitField {
        const stack = this;
        const val = stack.peek();
        if (val === undefined) {
            return undefined;
        }
        const [type, bf] = val;
        if (type === SType.BitField) {
            stack.pop();
            return bf;
        } else if (type === SType.Value && bf === 'all') {
            stack.pop();
            return createBitField(bf);
        }
        return undefined;
    }

    toString(reverse = true): string {
        return stackToString(this, reverse);
    }
}

export function isStackValue(value: any): boolean {
    return Array.isArray(value) && value.length == 2;
}

export interface PushOptions {
    debug?: boolean;
    ignoreActive?: boolean;
    ticket?: string;
    isWord?: boolean;
    evalEscape?: boolean;
}

export interface ExecuteOptions {
    pushResult?: boolean;
}

// interface WordMap {
//     [word: string]: [WordFn, SType[]]
// };

function matchWordArgs(find: WordArgs, pattern: WordEntry) {
    const [fn, pArgs] = pattern;
    return JSON.stringify(find) === JSON.stringify(pArgs);
}

export function entityIdFromValue(value: StackValue): EntityId {
    const [type, val] = value;
    switch (type) {
        case SType.Entity:
        case SType.Component:
            return getEntityId(val);
        case SType.Value:
            return isInteger(val) ? val : undefined;
        default:
            return undefined;
    }
}

function matchStack(stackItems: StackValue[], pattern: SType[]) {
    if (pattern === undefined) {
        return true;
    }
    const pLength = pattern.length;
    if (pLength === 0) {
        return true;
    }
    const sLength = stackItems.length;
    if (pLength > sLength) {
        return false;
    }
    for (let ii = 0; ii < pLength; ii++) {
        const sym = pattern[pLength - 1 - ii];
        const [vt, v] = stackItems[sLength - 1 - ii];
        if (sym !== SType.Any && sym !== vt && sym !== v) {
            // Log.debug('[matchStack]', sym, vt, v );
            return false;
        }
    }
    // Log.debug('[matchStack]', pattern, stackItems );
    return true;
}

export function assertStackSize(stack: QueryStack, expected: number, msg?: string) {
    const len = stack.items.length;
    if (len < expected) {
        if (msg === undefined) {
            msg = `expected stack size ${expected}, actual: ${len}`;
        }
        throw new Error(msg);
    }
}

export function assertStackValueType(stack: QueryStack, index: number, opType: string, argType?: any) {
    // Log.debug('[assertStackValueType]', 'argType', argType );
    const len = stack.items.length;
    const idx = len - 1 - index;
    if (idx < 0) {
        throw new Error(`value out of bounds: -${index + 1} : ${len}`);
    }
    const value: StackValue = stack.items[idx];
    if (value[0] !== opType) {
        throw new Error(`expected value of type ${opType} at index ${idx} : got ${value[0]}`);
    }
    if (argType !== undefined && typeof value[1] !== argType) {
        throw new Error(`expected arg of type ${argType} at index ${idx} : got ${typeof value[1]}`);
    }
}

export function isDLogEnabled<QS extends QueryStack>(stack: QS) {
    const wordFn = stack.getWord([SType.Value, 'trace']);
    return wordFn !== undefined && isStackValue(wordFn) && wordFn[1] === true;
}
export function DLog<QS extends QueryStack>(stack: QS, ...args) {
    const wordFn = stack.getWord([SType.Value, 'trace']);
    if (wordFn === undefined || !isStackValue(wordFn)) {
        return;
    }

    if (wordFn[1]) {
        Log.debug(...args);
    }
}
