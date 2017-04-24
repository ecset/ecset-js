import arrayDifference from './difference';

/**
 * 
 * @param {*} array 
 * @param {*} other 
 */
export default function arrayWithout(array, other) {
    if( !Array.isArray(other) ){
        return array.filter(x => x !== other );
    }
    return arrayDifference(array, other);
}