// import FlakeId63 from 'flake-idgen-63';
// import intformat from 'biguint-format';

import { suite } from 'uvu';
import assert from 'uvu/assert';

const test = suite('Snowflake ids');

/**
 * flake53 (https://github.com/cablehead/python-fity3)
 *
 * timestamp | workerId | sequence
 * 41 bits  |  8 bits   |  4 bits
 *
 *
 * flake63 (https://github.com/luxe-eng/flake-idgen-63)
 * (63bit in order to help java, the poor thing)
 *
 * reserved | timestamp | processId | workerId | sequence
 * 1 bit    | 42 bits   | 4 bits    | 5 bits   | 12 bits
 *                      | id                   |
 *                      | 9 bits               |
 *
 *
 * discord/twitter64 (https://discordapp.com/developers/docs/reference#snowflakes)
 *
 * timestamp | workerId | processId | sequence
 * 42 bits   | 5 bits   | 5 bits    | 12 bits
 *
 */

// it('flakeId63', () => {
//     const flakeIdGen63 = new FlakeId63({
//         processId: 15, // 0 - 15
//         worker: 31 // 0 - 31
//     });

//     const flake = flakeIdGen63.next();

//     console.info([...flake]);
//     console.info(intformat(flake, 'dec'));
//     console.info(intformat(flake, 'hex', { groupsize: 2 }));
//     console.info(intformat(flake, 'bin', { groupsize: 4 }));

//     // 3262265848503439360
//     // 3262267454246588416

//     console.info(parseFlake63(int64_to_str([...flake])));
// });

test('flake parsing', () => {
    const flake = new Uint8Array([45, 69, 229, 129, 70, 239, 144, 0]);

    const processId = (flake[5] >> 1) & 0xf;

    assert.equal(processId, 7);

    const worker = ((flake[5] & 0x1) << 4) | ((flake[6] & 0xf0) >> 4);

    assert.equal(worker, 25);

    const counter = ((flake[6] & 0xf) << 8) | flake[7];

    assert.equal(counter, 0);

    // const firstSixBytes = 49778226448111;
    const firstSixBytes =
        lshift(flake[0], 40) +
        lshift(flake[1], 32) +
        lshift(flake[2], 24) +
        lshift(flake[3], 16) +
        lshift(flake[4], 8) +
        flake[5];
    const timestamp = rshift(firstSixBytes, 5); // shift by 5

    assert.equal(timestamp, 1555569576503);

    // console.log( flake.length );
    // console.info(  _arrayBufferToBase64(flake) );//  intformat(flake, 'bin', { groupsize: 4 }));

    // (( flake[5] & 0xE0) >> 5)
});

test('flake parse', () => {
    // see also https://github.com/negezor/snowyflake - uses BigInt though
    const flake = new Uint8Array([45, 70, 0, 166, 181, 191, 240, 0]);
    const view = new DataView(flake.buffer);

    // console.info( getBigUint64(view) );
    // console.info( getUint64(view) );
    // console.info( int64_to_str( [...flake] ) );
    // 3262295696090329088
    // 3262295696090329088n
    // 3262295696090329000

    assert.equal(int64_to_str([...flake]), '3262295696090329088');

    assert.equal(parseFlake63('3262295696090329088'), {
        counter: 0,
        processId: 15,
        date: new Date('2019-04-18T10:36:48.941Z'),
        id: 511,
        timestamp: 1555583808941,
        worker: 31,
    });

    assert.equal(hexToInt64Array('0x2D4600A6B5BFF000'), [45, 70, 0, 166, 181, 191, 240, 0]);
    assert.equal(stringToInt64Array('3262295696090329088'), [45, 70, 0, 166, 181, 191, 240, 0]);

    const descr = {
        counter: 1459,
        processId: 6,
        worker: 31,
        timestamp: 1555594808509,
    };

    assert.equal(buildFlake63(descr), '3262318763855181235');

    // ((data[6] & 0xF) << 8) | data[7];
    assert.equal(parseFlake63('3262318763855181235', 'arr'), [45, 70, 21, 161, 151, 173, 245, 179]);

    assert.equal(parseFlake63('3262318763855181235'), {
        counter: 1459,
        processId: 6,
        date: new Date('2019-04-18T13:40:08.509Z'),
        id: 223,
        timestamp: 1555594808509,
        worker: 31,
    });

    // expect( parseFlake63('3262318763855061171', 'bin') ).toEqual( '' );
});

test('flake53', () => {
    const data = {
        timestamp: 1555608701611,
        workerId: 14,
        sequence: 10,
        epoch: TwitterEpoch,
    };

    assert.equal(buildFlake53(data), 582606444998890);

    assert.equal(parseFlake53(582606444998890, data.epoch), data);

    assert.ok(Number.isSafeInteger(582606444998890));

    assert.equal(stringToInt64Array('582606444998890'), [0, 2, 17, 224, 162, 50, 176, 234]);
});

test.run();

const TwitterEpoch = 1413370800000;
const Epoch = 1546333200000;

const Flake53WorkerIdBits = 8;
const Flake53SequenceBits = 4;
const Flake53TimestampLeftShift = Flake53SequenceBits + Flake53WorkerIdBits;

interface Flake53Params {
    timestamp: number;
    workerId: number;
    sequence: number;
    epoch?: number;
}

/**
 * a 53 bit flake, which helps in IEEE 754 environments, particularly javascript
 * Thankyou to https://github.com/cablehead/python-fity3 for not having to think about this
 * timestamp | workerId | sequence
 * 41 bits  |  8 bits   |  4 bits
 *
 */
function buildFlake53({
    timestamp = Date.now(),
    workerId = 0,
    sequence = 0,
    epoch = TwitterEpoch,
}: Flake53Params): number {
    const workerIdShift = Flake53SequenceBits;

    return lshift(timestamp - epoch, Flake53TimestampLeftShift) + lshift(workerId, workerIdShift) + sequence;
}

/**
 *
 * the elixir parse looks like this: << timestamp :: size(52), workerId :: size(8), sequence :: size(4) >> = <<505676010::64>>
 * @param flake53
 * @param epoch
 */
function parseFlake53(flake53: number, epoch: number = TwitterEpoch): Flake53Params {
    return {
        timestamp: rshift(flake53, Flake53TimestampLeftShift) + epoch,
        workerId: rshift(flake53, Flake53SequenceBits) & 0xff,
        sequence: flake53 & 0xf,
        epoch,
    };
}

// https://gist.github.com/lttlrck/4129238
function hexToInt64Array(str: string) {
    const result = new Array(8);

    let hiStr = (str + '').replace(/^0x/, '');
    const loStr = hiStr.substr(-8);
    hiStr = hiStr.length > 8 ? hiStr.substr(0, hiStr.length - 8) : '';

    const hi = parseInt(hiStr, 16);
    let lo = parseInt(loStr, 16);

    const o = 0;
    for (let i = 7; i >= 0; i--) {
        result[o + i] = lo & 0xff;
        lo = i === 4 ? hi : lo >>> 8;
    }

    return result;
}

function stringToInt64Array(str: string) {
    // because i am lame and cant find a direct means
    // of converting a dec string, i convert to hex
    // first
    return hexToInt64Array(decToHex(str));
}

// http://www.danvk.org/hex2dec.html
function decToHex(decStr) {
    const hex = convertBase(decStr, 10, 16);
    return hex ? '0x' + hex : null;
}

function convertBase(str, fromBase, toBase) {
    const digits = parseToDigitsArray(str, fromBase);
    if (digits === null) return null;

    let outArray = [];
    let power = [1];
    for (let i = 0; i < digits.length; i++) {
        // invariant: at this point, fromBase^i = power
        if (digits[i]) {
            outArray = add(outArray, multiplyByNumber(digits[i], power, toBase), toBase);
        }
        power = multiplyByNumber(fromBase, power, toBase);
    }

    let out = '';
    for (let i = outArray.length - 1; i >= 0; i--) {
        out += outArray[i].toString(toBase);
    }
    return out;
}

function parseToDigitsArray(str, base) {
    const digits = str.split('');
    const ary = [];
    for (let i = digits.length - 1; i >= 0; i--) {
        const n = parseInt(digits[i], base);
        if (isNaN(n)) return null;
        ary.push(n);
    }
    return ary;
}

// Returns a*x, where x is an array of decimal digits and a is an ordinary
// JavaScript number. base is the number base of the array x.
function multiplyByNumber(num, x, base) {
    if (num < 0) {
        return null;
    }
    if (num === 0) {
        return [];
    }

    let result = [];
    let power = x;
    while (true) {
        if (num & 1) {
            result = add(result, power, base);
        }
        num = num >> 1;
        if (num === 0) break;
        power = add(power, power, base);
    }

    return result;
}

// Adds two arrays for the given base (10 or 16), returning the result.
// This turns out to be the only "primitive" operation we need.
function add(x, y, base) {
    const z = [];
    const n = Math.max(x.length, y.length);
    let carry = 0;
    let i = 0;
    while (i < n || carry) {
        const xi = i < x.length ? x[i] : 0;
        const yi = i < y.length ? y[i] : 0;
        const zi = carry + xi + yi;
        z.push(zi % base);
        carry = Math.floor(zi / base);
        i++;
    }
    return z;
}

// const getUint64 = function(view, byteOffset = 0, littleEndian = false) {
//     // split 64-bit number into two 32-bit parts
//     const left =  view.getUint32(byteOffset, littleEndian);
//     const right = view.getUint32(byteOffset+4, littleEndian);

//     // combine the two 32-bit values
//     const combined = littleEndian? left + 2**32*right : 2**32*left + right;

//     if (!Number.isSafeInteger(combined)){
//       console.warn(combined, 'exceeds MAX_SAFE_INTEGER. Precision may be lost');
//     }

//     return combined;
//   }

//   https://stackoverflow.com/a/45631312/2377677
function int64_to_str(a: number[], signed = false): string {
    const negative = signed && a[0] >= 128;
    const H = 0x100000000;
    const D = 1000000000;
    let h = a[3] + a[2] * 0x100 + a[1] * 0x10000 + a[0] * 0x1000000;
    let l = a[7] + a[6] * 0x100 + a[5] * 0x10000 + a[4] * 0x1000000;
    if (negative) {
        h = H - 1 - h;
        l = H - l;
    }
    const hd = Math.floor((h * H) / D + l / D);
    const ld = ((((h % D) * (H % D)) % D) + l) % D;
    const ldStr = ld + '';
    return (negative ? '-' : '') + (hd !== 0 ? hd + '0'.repeat(9 - ldStr.length) : '') + ldStr;
}

function parseFlake63(flake: string, format = 'obj') {
    const data = stringToInt64Array(flake);

    if (format === 'arr') {
        return data;
    }

    const processId = (data[5] >> 1) & 0xf;
    const worker = ((data[5] & 0x1) << 4) | ((data[6] & 0xf0) >> 4);
    const counter = ((data[6] & 0xf) << 8) | data[7];
    const id = (processId << 5) | worker;

    const firstSixBytes =
        lshift(data[0], 40) +
        lshift(data[1], 32) +
        lshift(data[2], 24) +
        lshift(data[3], 16) +
        lshift(data[4], 8) +
        data[5];
    // take out the lower 5 bits
    const timestamp = rshift(firstSixBytes, 5); // right shift 5

    return {
        id,
        processId,
        worker,
        counter,
        timestamp,
        date: new Date(timestamp),
    };
}

interface BuildFlakeParams {
    id?: number;
    processId?: number;
    worker?: number;
    counter: number;
    timestamp: number;
    reserved?: boolean;
}

function buildFlake63({ id, processId = 0, worker = 0, counter, timestamp, reserved = false }: BuildFlakeParams) {
    worker = worker & 0x1f;
    processId = processId & 0x0f;
    id = id === undefined ? (processId << 5) | worker : id & 0x3ff;
    const reservedBit = reserved ? 1 : 0;

    const result = new Array(8);

    // first 7 bits - so we have space for reserved
    let accum = rshift(timestamp, 42 - 7);
    result[0] = (reservedBit << 7) | (accum & 0x7f);

    accum = rshift(timestamp, 42 - 7 - 8);
    result[1] = accum & 0xff;

    accum = rshift(timestamp, 42 - 7 - 8 - 8);
    result[2] = accum & 0xff;

    accum = rshift(timestamp, 42 - 7 - 8 - 8 - 8);
    result[3] = accum & 0xff;

    accum = rshift(timestamp, 42 - 7 - 8 - 8 - 8 - 8);
    result[4] = accum & 0xff;

    // // 6th byte is a combinate of timestamp and id
    accum = ((timestamp & 0xff) << 5) | (processId << 1) | (worker & 0x1);
    result[5] = accum & 0xff;

    result[6] = ((worker << 4) & 0xff) | ((counter >> 8) & 0xff);

    result[7] = counter & 0xff;

    return int64_to_str(result);
}

/*
 
0 010 0111 1011 1000 0101 1100 1001 0110 0000 0000 001 1 111 0 0001 0000 0000 0010
                                                                    |---- ---- ----|  12 bit counter
                                                             |- ----|                  5 bit worker
                                                       |- ---|                         4 bit processId
  |--- ---- ---- ---- ---- ---- ---- ---- ---- ---- ---|                              42 bit timestamp
|-|                                                                                    1 bit reserved

first 6 bytes - 48

01234560123456012345670123456701234567012
000000x11111112222222233333333x4444444555
101101x10001011110010110000001x1000110111
10110101000101111001011000000101000110111


49778226448111 - first 6 bytes
1011010100010111100101100000010100011011101111
1011010100010111100101100000010100011011101111
// get bottom 5 bits
1011010100010111100101100000010100011011100000
1111111111111111111111111111111111111111100000
11100101100000010100011011100000
 */

// function _arrayBufferToBase64( buffer ) {
//     let binary = '';
//     let bytes = new Uint8Array( buffer );
//     let len = bytes.byteLength;
//     for (let i = 0; i < len; i++) {
//         binary += String.fromCharCode( bytes[ i ] );
//     }
//     return btoa( binary );
// }

/**
 * Convenience for safely left shifting
 * numbers, because << doesnt work on > 32bit
 *
 * @param num
 * @param bits
 */
function lshift(num, bits) {
    return num * Math.pow(2, bits);
}

function rshift(num, bits) {
    return Math.floor(num / Math.pow(2, bits));
}

// const strBin = str => parseInt(str, 2);

// const numBin = num => {
//     let sign = num < 0 ? '-' : '';
//     let result = Math.abs(num).toString(2);
//     while (result.length < 32) {
//         result = '0' + result;
//     }
//     return sign + result;
// };

// function ArrayBufferToString(buffer) {
//     return BinaryToString(
//         String.fromCharCode.apply(
//             null,
//             Array.prototype.slice.apply(new Uint8Array(buffer))
//         )
//     );
// }

// function StringToArrayBuffer(string) {
//     return StringToUint8Array(string).buffer;
// }

// function BinaryToString(binary) {
//     let error;

//     try {
//         return decodeURIComponent(escape(binary));
//     } catch (_error) {
//         error = _error;
//         if (error instanceof URIError) {
//             return binary;
//         } else {
//             throw error;
//         }
//     }
// }

function StringToBinary(string) {
    let chars, code, i, isUCS2, len, _i;

    len = string.length;
    chars = [];
    isUCS2 = false;
    for (i = _i = 0; 0 <= len ? _i < len : _i > len; i = 0 <= len ? ++_i : --_i) {
        code = String.prototype.charCodeAt.call(string, i);
        if (code > 255) {
            isUCS2 = true;
            chars = null;
            break;
        } else {
            chars.push(code);
        }
    }
    if (isUCS2 === true) {
        return unescape(encodeURIComponent(string));
    } else {
        return String.fromCharCode.apply(null, Array.prototype.slice.apply(chars));
    }
}

// function StringToUint8Array(string) {
//     let binary, binLen, buffer, chars, i, _i;
//     binary = StringToBinary(string);
//     binLen = binary.length;
//     buffer = new ArrayBuffer(binLen);
//     chars = new Uint8Array(buffer);
//     for (
//         i = _i = 0;
//         0 <= binLen ? _i < binLen : _i > binLen;
//         i = 0 <= binLen ? ++_i : --_i
//     ) {
//         chars[i] = String.prototype.charCodeAt.call(binary, i);
//     }
//     return chars;
// }
