import { PolymerElement, html } from '@polymer/polymer/polymer-element';

import '@polymer/iron-ajax/iron-ajax';

import './buttress-db-data-service.js';
import './buttress-db-realtime-handler.js';

import './libs/fingerprint2.js';

import { AppDb } from './buttress-db-schema.js';
import Worker from './buttress-db-worker.js';

import 'sugar/dist/sugar';

export class ButtressDb extends PolymerElement {
  static get is() { return 'buttress-db'; }

  static get template() {
    return html`
      <style>
        :host {
          display: none;
        }
      </style>

      <iron-ajax
        id="schema",
        url="[[endpoint]]/api/v1/app/schema",
        params="{{rqSchemaParams}}",
        handleAs="json",
        last-response="{{dbSchema}}",
        on-error="__dbSchemaError">
      </iron-ajax>

      <template id="dataServices" is="dom-repeat" items="{{__collections}}">
        <buttress-db-data-service
          id="[[item.name]]"
          token="[[token]]",
          api-path="[[apiPath]]",
          endpoint="[[endpoint]]",
          route="[[item.name]]",
          loaded="{{item.loaded}}",
          status="{{item.status}}",
          data="{{item.data}}",
          priority="[[item.priority]]",
          core="[[item.core]]",
          logging="[[logging]]",
          auto-load>
        </buttress-db-data-service>
      </template>

      <buttress-db-realtime-handler
        token="[[token]]",
        endpoint="[[endpoint]]",
        app-id="[[appId]]",
        user-id="[[userId]]",
        db="{{db}}",
        connected="{{io.connected}}",
        synced="{{io.synced}}",
        logging="[[logging]]"
      ></buttress-db-realtime-handler>
    `;
  }

  static get properties() {
    return {
      endpoint: String,
      token: String,
      appId: String,
      apiPath: String,
      userId: String,

      logging: {
        type: Boolean,
        value: false
      },

      loaded: {
        type: Boolean,
        notify: true,
        value: false
      },
      loading: {
        type: Object,
        notify: true,
        value: function() {
          return {
            loaded: false,
            unpacking: false,
            current: 0,
            total: 0
          }
        }
      },
      error: {
        type: Boolean,
        notify: true,
        value: false
      },
      lastError: {
        type: Object,
        notify: true,
      },

      __maxConcurrentRequests: {
        type: Number,
        value: 4
      },
      rqSchemaParams: {
        type: Object
      },

      dbSchema: {
        type: Array,
        value: function() {
          return [];
        }
      },
      db: {
        type: Object,
        value: function() {
          // post: {
          //   status: 'uninitialised',
          //   data: [],
          // }
          return {};
        },
        notify: true
      },
      io: {
        type: Object,
        value: function() {
          return {
            connected: false,
            synced: true
          };
        },
        notify: true
      },
      coreCollections: {
        type: Array,
        value: function() {
          return [];
        },
      },
      __collections: {
        type: Object,
        value: function() {
          return [];
        },
        notify: true
      },
      __services: {
        type: Array,
        value: function() {
          return [];
        }
      },
      __numRequests: {
        type: Number,
        value: 0
      },

      settings: {
        type: Object,
        notify: true,
        value: function() {
          return {
            logging: false,
            worker: false,
            local_sync: false,
            local_read: false,
            network_sync: false,
            network_read: true,
          };
        }
      },

      nonModuleDependencies: {
        type: Array,
        value: function() {
          return [{
            name: 'fingerprint',
            loaded: false,
            error: false
          }]
        }
      },

      __localDB: {
        type: Object
      },
      __worker: {
        type: Object
      },
      __workerTasks: {
        type: Object,
        value: function() {
          return {};
        }
      },
      __workerId: {
        type: Number,
        value: 1
      }
    };
  }

  static get observers() {
    return [
      '__tokenChanged(token, nonModuleDependencies.*)',
      '__dbSchemaChanged(coreCollections, dbSchema.*)',
      '__settingChanged(settings.*)'
    ];
  }
  
  ready() {
    super.ready();
    this.addEventListener('data-service-list', ev => this.__onDataLoaded(ev));
    this.addEventListener('data-service-ready', ev => this.__dataServiceReady(ev));
  }
  
  connectedCallback() {
    super.connectedCallback();
    const settings = this.get('settings');

    if (Fingerprint2) {
      const depIdx = this.get('nonModuleDependencies').findIndex(d => d.name === 'fingerprint');
      this.set(`nonModuleDependencies.${depIdx}.loaded`, true);

      Fingerprint2.get(components => {
        var values = components.map(function (component) { return component.value });
        var murmur = Fingerprint2.x64hash128(values.join(''), 31);
        let nibbles = murmur.match(/.{1}/g).map(n => parseInt(`0x${n}`, 16) > 7 ? 1 : 0);
        let id = 0;
        nibbles.forEach((n,idx) => id |= n << idx);
        AppDb.Fingerpint.machineId = id;
        AppDb.Fingerpint.processId = Math.floor(Math.random() * 100000) % 0xFFFF;
        AppDb.Fingerpint.inc = Math.floor(Math.random() * 65535) % 0xFFFF;
      });
    } else {
      const depIdx = this.get('nonModuleDependencies').findIndex(d => d.name === 'fingerprint');
      this.set(`nonModuleDependencies.${depIdx}.error`, true);
      this.set('error', true);
      this.set('lastError', new Error('Unable to load fingerprint, this is required for generating ids'));
      return;
    }

    this.set('db.Factory', AppDb.Factory);

    // Check local storage settings
    if ('localStorage' in window) {
      Object.keys(settings).forEach((key) => {
        const value = this.getOption(key);
        if (value === undefined || value === null) return; // Skip and use default
        this.set(`settings.${key}`, value);
        if (key === 'logging' && value === true) {
          this.set(`logging`, true);
        }
      });
    }
    
    if ('indexedDB' in window) {
      if (Worker && this.get('settings.worker')) {
        if (this.get('logging')) console.log('Talking to indexedDB via worker');
        const workerBlob = new Blob(['('+Worker.toString()+')()'], {type: 'application/javascript'});

        try {
          const dbWorker = Worker(URL.createObjectURL(workerBlob));
          dbWorker.onmessage = (ev) => this.__workerMessage(ev);
          dbWorker.onerror = (ev) => this.__workerError(ev);
          this.set('__worker', dbWorker);
        } catch (err) {
          console.error(err);
        }
      } else {
        if (this.get('logging')) console.log('Talking to indexedDB directly');
        this.set('__localDB', Worker());
      }
    }
  }

  __settingChanged(cr) {
    const path = cr.path.split('.');
    if (!path || path.length !== 2) return;
    path.shift();

    this.setOption(path, cr.value);
  }

  __dataServiceReady(ev){
    const collections = this.get('__collections');

    this.push('__services', ev.detail);

    if (collections.length === this.get('__services.length')) {
      this.set('loading.current', 0);
      this.set('loading.total', this.get('__collections.length'));
      this.__services.sort((a,b) => a.priority - b.priority);
      for (let x=0; x < this.__maxConcurrentRequests; x++)
        this.__onDataLoaded();
    }
  }

  __tokenChanged() {
    const token = this.get('token');
    const nonModuleDependencies = this.get('nonModuleDependencies');
    if (!token || nonModuleDependencies.some(d => d.loaded === false)){
      return;
    }

    // Fetch app schema using provided token
    this.set('rqSchemaParams', {
      urq: Date.now(),
      token: token
    });
    this.$.schema.generateRequest();
  }

  __dbSchemaError(ev) {
    this.set('error', true);
    this.set('lastError', ev);
  }

  __dbSchemaChanged() {
    const schema = this.get('dbSchema');
    const coreCollections = this.get('coreCollections');
    if (!schema || schema.length < 1) return;

    AppDb.Schema.schema = schema;

    coreCollections.forEach(collection => {
      const key = Sugar.String.camelize(collection, false);
      const idx = this.push('__collections', {
        name: collection,
        status: 'uninitialised',
        priority: 1,
        data: [],
        core: true
      }) - 1;
      this.set(['db', key], this.get(['__collections', idx]));
      this.linkPaths(['db', key], `__collections.${idx}`);
    });

    // Generate db data map
    schema.forEach(s => {
      const key = Sugar.String.camelize(s.name, false);
      const idx = this.push('__collections', {
        name: s.name,
        status: 'uninitialised',
        priority: 1,
        data: [],
        core: false
      }) - 1;
      this.set(['db', key], this.get(['__collections', idx]));
      this.linkPaths(['db', key], `__collections.${idx}`);
    });

    if (this.get('__localDB')) {
      const collections = [].concat(schema).map(c => Sugar.String.camelize(c.name, false));
      this.get('__localDB').init({
        task: 'init',
        name: 'Buttress',
        version: 1,
        collections: collections
      })
      .then(() => {
        if (this.get('settings.local_read') === true) {
          this.__localLoadCollections(collections)
            .then(result => {
              this.set('loaded', true);
              this.set('loading.loaded', true);
            })
        }
      });
    }

    if (this.get('__worker')) {
      const collections = [].concat(schema).map(c => Sugar.String.camelize(c.name, false));
      this.__workerTask({
        task: 'init',
        name: 'Buttress',
        version: 1,
        collections: collections
      })
      .then(() => {
        if (this.get('settings.local_read') === true) {
          this.__workerLoadCollections(collections)
            .then(result => {
              this.set('loaded', true);
              this.set('loading.loaded', true);
            })
        }
      });
    }
  }

  __onDataLoaded(ev) {
    const services = this.get('__services');

    // No check for network load
    if (!this.get('settings.network_read')) {
      if (this.get('logging')) console.warn('Data service disabled network call');
      return;
    }

    if (!ev && services.length > 0) {
      services.shift().triggerGet();
      this.__numRequests++;
      return;
    }

    if (--this.__numRequests === 0) {
      this.set('loaded', true);
      this.set('loading.loaded', true);
    }

    this.set('loading.current', this.get('loading.total') - this.get('__services.length') );
    this.set('loading.percent', (this.get('loading.current') / this.get('loading.total')) * 100);

    if (!services.length) {
      return;
    }

    services.shift().triggerGet();
    this.__numRequests++;
  }

  // Local Storage
  getOption(key) {
    if (!'localStorage' in window) return false;
    const value = window.localStorage.getItem(`buttress_${key}`);
    return typeof value == 'string' ? JSON.parse(value) : value;
  }
  setOption(key, value) {
    if (!'localStorage' in window) return false;
    window.localStorage.setItem(`buttress_${key}`, value);
  }

  // Worker IO
  clearCollections() {
    let method = null;

    if (this.get('__localDB')) method = (payload) => this.get('__localDB').clear(payload);
    if (this.get('__worker'))  method = (payload) => this.__workerTask(payload);

    if (!method) return;

    const results = this.get('__collections').reduce((out, collection) => {
      const collectionName = Sugar.String.camelize(collection.name, false);
      console.time(`Cleared ${collectionName}`);
      const promise = method({
        task: 'clear',
        collection: collectionName
      })
      .then(() => {
        console.timeEnd(`Cleared ${collectionName}`);
      });

      out.push(promise);
      return out;
    }, []);

    return Promise.all(results);
  }

  saveCollections() {
    let method = null;

    if (this.get('__localDB')) method = (payload) => this.get('__localDB').bulkWrite(payload);
    if (this.get('__worker'))  method = (payload) => this.__workerTask(payload);

    if (!method) return;

    const results = this.get('__collections').reduce((out, collection) => {
      const collectionName = Sugar.String.camelize(collection.name, false);
      console.time(`Write ${collection.data.length} to ${collectionName}`);
      const promise = method({
        task: 'bulkWrite',
        collection: collectionName,
        items: collection.data
      })
      .then(() => {
        console.timeEnd(`Write ${collection.data.length} to ${collectionName}`);
      });

      out.push(promise);
      return out;
    }, []);

    return Promise.all(results);
  }

  __localLoadCollections(collections) {
    if (this.get('logging')) console.log('__localLoadCollections', collections.length);
    const load = (collection) => {
      if (this.get('logging')) console.log(`local ${collection} load`);
      console.time(`local ${collection} loaded`);
      return this.get('__localDB').readAll({
        task: 'readAll',
        collection: collection
      })
      .then(data => {
        console.timeEnd(`local ${collection} loaded`);
        this.set(['db', collection, 'data'], data);
        this.set(['db', collection, 'loaded'], true);
      });
    };

    return Promise.all(collections.map(load));
  }

  __workerLoadCollections(collections) {
    const load = (collection) => {
      console.time(`local ${collection} loaded`);
      return this.__workerTask({
        task: 'readAll',
        collection: collection
      })
      .then(data => {
        console.timeEnd(`local ${collection} loaded`);
        this.set(['db', collection, 'data'], data.result);
        this.set(['db', collection, 'loaded'], true);
      });
    }

    return Promise.all(collections.map(load));
  }

  __workerTask(payload) {
    payload.id = this.get('__workerId');

    this.get('__worker').postMessage(payload);

    this.set('__workerId', this.get('__workerId') + 1);

    return new Promise((resolve, reject) => {
      this.set(`__workerTasks.${payload.id}`, {
        id: payload.id,
        resolve: resolve,
        reject: resolve
      });
    });
  }

  __workerMessage(ev) {
    const workerTasks = this.get('__workerTasks');
    const payload = ev.data;

    if (payload.id && workerTasks[payload.id]) {
      workerTasks[payload.id].resolve(payload);
      delete workerTasks[payload.id];
      return;
    }

    if (this.get('logging') && !payload.type) console.log(payload);

    switch(payload.type) {
      default:
        if (this.get('logging')) console.log(payload);
        break;
    }
  }
  __workerError(ev) {
    if (this.get('logging')) console.error('__workerError', ev);
  }
}

window.customElements.define(ButtressDb.is, ButtressDb);
