import propertyResult from './result';
import {isObject} from './is';

/**
 * A collection stores a set of objects keyed by the id attribute
 */
export default function Collection(models, options = {}) {
    this.idAttribute = options.idAttribute || 'id';
    // this.debug = propertyResult( options, 'debug', false);
    this.reset();
    if (models !== undefined) {
        this.add(models);
    }
}

/**
 * 
 */
Object.assign(Collection.prototype, {
    /**
     * Adds an object to the collection. If an object with the same id
     * already exists in the collection, it is replaced.
     * 
     * @param {*} obj 
     */
    add(obj) {
        if (!obj) {
            return;
        }
        
        if (Array.isArray(obj) && obj[0] !== undefined) {
            obj.forEach(item => this.add(item));
            return this;
        }
        
        const idAttr = this.idAttribute;
        const key = propertyResult(obj,idAttr);// obj[idAttr];
        const existing = this._objectsById[key];

        this._objectsById[key] = obj;

        if (existing !== undefined) {
            // replace the existing object
            const index = this._indexOfObject[key];
            this.models[index] = obj;
            return this;
        }

        this._indexOfObject[key] = this.models.length;

        this.models.push(obj);

        return this;
    },

    /**
     * Removes an object from the collection
     * @param {*} obj 
     */
    remove(obj) {
        if (Array.isArray(obj) && obj[0] !== undefined) {
            obj.forEach(item => this.remove(item));
            return this;
        }
        
        const objId = propertyResult(obj,this.idAttribute);

        if (this._objectsById[objId] !== undefined) {
            const index = this._indexOfObject[objId];

            this.models.splice(index, 1);

            delete this._objectsById[objId];
            delete this._indexOfObject[objId];
        }

        this._reindex();

        return this;
    },

    /**
     * Returns an object at the given index
     * 
     * @param {*} index 
     */
    at(index) {
        return this.models[index];
    },

    /**
     * Returns an object by its id
     *  
     * @param {*} id 
     */
    get(id) {
        return this._objectsById[String(id)];
    },

    /**
     * Returns true if the object is contained in this collection
     * 
     * @param {*} obj 
     */
    has(obj) {
        let id = obj;
        if( isObject(obj) ){
            id = propertyResult(obj,this.idAttribute, obj);
        }
        return this._objectsById[id] !== undefined;
    },

    /**
     * Returns the first item which matches the specific attributes
     * @param {*} attrs 
     */
    findWhere(attrs) {
        return this.models.find( el => this.isMatch(el,attrs) );
    },

    /**
     * Returns true if the given object has the given attributes
     * @param {*} object 
     * @param {*} attrs 
     */
    isMatch(object, attrs) {
        let keys = Object.keys(attrs),
            length = keys.length;
        if (object == null) {
            return !length;
        }
        let obj = Object(object);
        for (let ii = 0; ii < length; ii++) {
            let key = keys[ii];
            if (attrs[key] !== obj[key] || !(key in obj)) {
                return false;
            }
        }
        return true;
    },

    /**
     * 
     */
    _reindex() {
        let ii = 0;
        let len = this.models.length;
        for (ii = 0; ii < len; ii++) {
            let obj = this.models[ii];
            let objId = propertyResult(obj,this.idAttribute);
            this._indexOfObject[objId] = ii;
        }
    },

    /**
     * 
     */
    size() {
        return this.models.length;
    },

    /**
     * 
     */
    reset() {
        this.models = [];
        this._objectsById = {};
        this._indexOfObject = [];
    },

    /**
     * 
     * @param {*} fn 
     */
    map(fn) {
        return this.models.map(fn);
    },

    /**
     * 
     * @param {*} fn 
     * @param {*} initialValue 
     */
    reduce(fn, initialValue) {
        return this.models.reduce(fn, initialValue);
    },

    /**
     * 
     */
    toJSON() {
        return this.models;
    }
});

Collection.prototype.type = 'Collection';
