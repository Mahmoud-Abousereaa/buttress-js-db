import { PolymerElement, html } from '@polymer/polymer/polymer-element.js';
import { timeOut } from '@polymer/polymer/lib/utils/async.js';
import { Debouncer } from '@polymer/polymer/lib/utils/debounce.js';
import { get as getPath } from '@polymer/polymer/lib/utils/path.js';

export class ButtressDbQuery extends PolymerElement {
  static get is() { return 'buttress-db-query'; }

  static get template() {
    return html`
      <style>
        :host {
          display: none;
        }
      </style>
    `;
  }
  static get properties() {
    return {
      logLabel: {
        type: String,
        value: 'db-query'
      },
      logging: {
        type: Boolean,
        value: false
      },
      db: {
        type: Object
      },
      doc: {
        type: Object,
        notify: true
      },
      dataPath: {
        type: String
      },
      numResults: {
        type: Number,
        value: 0,
        notify: true
      },
      numPages: {
        type: Number,
        value: 0,
        notify: true
      },
      page: {
        type: Number,
        value: 1
      },
      limit: {
        type: Number,
        value: 50
      },
      findOne: {
        type: Object,
        notify: true
      },
      findAll: {
        type: Array,
        notify: true
      },
      findAllUnpaged: {
        type: Array,
        notify: true
      },
      query: {
        type: Object,
      },
      
      loading: {
        type: Boolean,
        notify: true,
        value: false
      },

      sortPath: {
        type: String
      },
      sortType: {
        type: String,
        value: 'string'
      },
      sortOrder: {
        type: String,
        value: 'DESC'
      },

      __debouncer: Object,

      paused: {
        type: Boolean,
        value: false
      }
    };
  }
  static get observers() {
    return [
      '__queryDebouncer(query.*, page, limit, paused)',
      '__docStatus(doc, doc.loaded)'
    ];
  }

  __docStatus() {
    if (!this.doc || !this.doc.loaded) {
      if (this.logging) console.log(this.logLabel, 'silly', '__docStatus', this.doc.status, this.doc);
      return;
    }

    if (this.logging) console.log(this.logLabel, 'silly', '__docStatus', 'doc.status', this.doc.status);

    if (this.query) {
      if (this.logging) console.log(this.logLabel, 'silly', '__docStatus', 'query', this.query);
      this.set('query.__loaded', true);
    }
  }
  __queryDebouncer() {
    this.set('loading', true);
    const doc = this.get('doc');
    if (!doc || !doc.loaded) {
      if (this.logging) console.log(this.logLabel, 'debug', '__queryDebouncer', 'no doc');
      return;
    }

    // If we have an update to a path notify straight away
    let crPath = null;
    if (this.get('query.__crPath') && this.get('dataPath')) {
      // Fetch the change record path from the query if passed through
      // remove the data path from the change record path
      crPath = this.get('query.__crPath').replace(this.get('dataPath'), '');
      if (crPath.indexOf('.') === 0) {
        crPath = crPath.substring(1);
      }
    }
    if (crPath) {
      const splitCRPath = crPath.split('.');
      const docCRIdx = splitCRPath.shift();
      const docCRItem = doc.data[docCRIdx];

      if (this.get('findAllUnpaged')) {
        const findAllUnpagedIdx = this.get('findAllUnpaged').findIndex(i => i === docCRItem);
        if (findAllUnpagedIdx !== -1) {
          this.notifyPath(`findAllUnpaged.${findAllUnpagedIdx}.${splitCRPath.join('.')}`);
        }
      }
      if (this.get('findAll')) {
        const findAllIdx = this.get('findAll').findIndex(i => i === docCRItem);
        if (findAllIdx !== -1) {
          this.notifyPath(`findAll.${findAllIdx}.${splitCRPath.join('.')}`);
        }
      }
      if (this.get('findOne')) {
        if (docCRItem === this.get('findOne')) {
          this.notifyPath(`findOne.${splitCRPath.join('.')}`);
        }
      }
    }

    // Debounce the query till later
    this.set('_debouncer', Debouncer.debounce(
      this.get('_debouncer'),
      timeOut.after(100),
      () => {
        this.__query()
        .then(() => {
          this.set('loading', false);
        });
      }
    ));
  }
  __query() {
    return new Promise(resolve => {
      if (this.logging) console.log(this.logLabel, 'debug', '__query', this.query);
      if (!this.query) {
        if (this.logging) console.log(this.logLabel, 'silly', '__query', 'no query');
        return resolve(false);
      }
      if (this.get('paused') === true) {
        if (this.logging) console.log(this.logLabel, 'silly', '__query', 'Paused');
        return resolve(false);
      }

      if (this.logging) console.log(this.logLabel, 'silly', this.query);

      let data = this.doc.data;
      if (this.logging) console.log(this.logLabel, 'silly', data);
      try {
        data = this.__processQuery(this.query, data);
      } catch (err) {
        console.error('Query was:', this.query);
        throw err;
      }
      if (this.logging) console.log(this.logLabel, 'silly', data);

      if (this.get('sortPath')) {
        data.sort((a, b) => this.__sort(a, b));
      }

      if (this.limit > 0) {
        this.set('numPages', Math.ceil(data.length / this.limit));
        this.set('numResults', data.length);
        this.set('findAllUnpaged', data.concat([]));

        if (this.logging) console.log(this.logLabel, 'silly', `Page: ${this.page}, Limit ${this.limit}, NumPages: ${this.numPages}`);
        data = data.splice((this.page-1) * this.limit, this.limit);
        if (this.logging) console.log(this.logLabel, 'debug', data);
      }

      this.set('findAll', data);

      this.set('findOne', data.length > 0 ? data[0] : null);

      if (this.logging) console.log(this.logLabel, 'silly', this.findOne);

      return resolve(true);
    });
  }

  __processQuery(query, data) {
    let outData = [].concat(data);

    for (let field in query) {
      if (!query.hasOwnProperty(field)) {
        continue;
      }

      if (field === '__crPath') {
        continue;
      }

      if (field === '$and') {
        query[field].forEach(o => {
          outData = this.__processQuery(o, outData);
        });
        continue;
      }

      if (field === '$or') {
        outData = query[field]
          .map(o => this.__processQuery(o, outData))
          .reduce((combined, results) => {
            return combined.concat(results.filter(r => combined.indexOf(r) === -1));
          }, []);

        continue;
      }

      let command = query[field];
      for (let operator in command) {
        if (!command.hasOwnProperty(operator)) {
          continue;
        }

        let operand = command[operator];
        outData = this.__executeQuery(outData, field, operator, operand);
      }
    }
    return outData;
  }

  __sort(a, b){
    const sortPath = this.get('sortPath');
    const sortType = this.get('sortType');
    const sortOrder = this.get('sortOrder');

    const pathValueA = this.__parsePath(a, sortPath);
    const pathValueB = this.__parsePath(b, sortPath);

    let valueA = pathValueA[0];
    let valueB = pathValueB[0];

    if (sortType === 'numeric') {
      return (sortOrder === 'ASC') ? valueA - valueB : valueB - valueA;
    }
    if (sortType === 'string') {
      valueA = (valueA) ? valueA.toLowerCase(): '';
      valueB = (valueB) ? valueB.toLowerCase(): '';
    }
    if (sortType === 'date') {
      return (sortOrder === 'ASC') ? new Date(valueA) - new Date(valueB) : new Date(valueB) - new Date(valueA);
    }

    if (sortOrder === 'ASC') {
      return valueA.localeCompare(valueB);
    }

    return valueB.localeCompare(valueA);
  }

  __parsePath(obj, path) {
    const value = getPath(obj, path);
    return Array.isArray(value) ? value : [value];
  }

  __executeQuery(data, field, operator, operand) {

    let fns = {
      $not: (rhs) => (lhs) => this.__parsePath(lhs, field).findIndex(val => val !== rhs) !== -1,
      $eq: (rhs) => (lhs) => this.__parsePath(lhs, field).findIndex(val => val === rhs) !== -1,
      $gt: (rhs) => (lhs) => this.__parsePath(lhs, field).findIndex(val => val > rhs) !== -1,
      $lt: (rhs) => (lhs) => this.__parsePath(lhs, field).findIndex(val => val < rhs) !== -1,
      $gte: (rhs) => (lhs) => this.__parsePath(lhs, field).findIndex(val => val >= rhs) !== -1,
      $lte: (rhs) => (lhs) => this.__parsePath(lhs, field).findIndex(val => val <= rhs) !== -1,
      $rex: (rhs) => (lhs) => this.__parsePath(lhs, field).findIndex(val => (new RegExp(rhs)).test(val)) !== -1,
      $rexi: (rhs) => (lhs) => this.__parsePath(lhs, field).findIndex(val => (new RegExp(rhs, 'i')).test(val)) !== -1,
      $in: (rhs) => (lhs) => rhs.indexOf(lhs[field]) !== -1,
      $nin: (rhs) => (lhs) => rhs.indexOf(lhs[field]) === -1,
      $exists: (rhs) => (lhs) => this.__parsePath(lhs, field).findIndex(val => val === undefined) === -1 === rhs,
      $inProp: (rhs) => (lhs) => lhs[field].indexOf(rhs) !== -1,
      $elMatch: (rhs) => (lhs) => this.__processQuery(rhs, this.__parsePath(lhs, field)).length > 0,
      $gtDate: (rhs) => {
        if (rhs === null) return false;
        const rhsDate = Sugar.Date.create(rhs);

        return (lhs) => this.__parsePath(lhs, field).findIndex(val => {
          if (val === null) return false; // Dont compare against null value
          return Sugar.Date.isBefore(rhsDate, val);
        }) !== -1;
      },
      $ltDate: (rhs) => {
        if (rhs === null) return false;
        const rhsDate = Sugar.Date.create(rhs);

        return (lhs) => this.__parsePath(lhs, field).findIndex(val => {
          if (val === null) return false; // Dont compare against null value
          return Sugar.Date.isAfter(rhsDate, val);
        }) !== -1;
      },
      $gteDate: (rhs) => {
        if (rhs === null) return false;
        const rhsDate = Sugar.Date.create(rhs);

        return (lhs) => this.__parsePath(lhs, field).findIndex(val => {
          if (val === null) return false; // Dont compare against null value
          return Sugar.Date.isBefore(rhsDate, val) || Sugar.Date.is(rhsDate, val);
        }) !== -1;
      },
      $lteDate: (rhs) => {
        if (rhs === null) return false;
        const rhsDate = Sugar.Date.create(rhs);

        return (lhs) => this.__parsePath(lhs, field).findIndex(val => {
          if (val === null) return false; // Dont compare against null value
          return Sugar.Date.isAfter(rhsDate, val) || Sugar.Date.is(rhsDate, val);
        }) !== -1;
      }
    };

    if (!fns[operator]) {
      console.error(new Error(`Invalid operator: ${operator}`));
      return [];
    }

    let results = data.filter(fns[operator](operand));
    if (this.logging) console.log(this.logLabel, 'debug', '__executeQuery', field, operator, operand, data.length, results.length);

    return results;
  }
}
window.customElements.define(ButtressDbQuery.is, ButtressDbQuery);
