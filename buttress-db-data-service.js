import { PolymerElement, html } from '@polymer/polymer/polymer-element.js';
import { timeOut } from '@polymer/polymer/lib/utils/async.js';
import { Debouncer } from '@polymer/polymer/lib/utils/debounce.js';

import { AppDb } from './buttress-db-schema.js';

export default class ButtressDbDataService extends PolymerElement {
  static get is() { return 'buttress-db-data-service'; }

  static get template() {
    return html`<style>:host { display: none; }</style>`;
  }

  static get properties() {
    return {
      id: String,
      token: String,
      endpoint: String,
      apiPath: String,
      settings: Object,

      status: {
        type: String,
        value: '',
        notify: true,
      },

      logging: {
        type: Boolean,
        value: false
      },

      core: {
        type: Boolean,
        value: false
      },

      loaded: {
        type: Boolean,
        value: false,
        notify: true,
        reflectToAttribute: true
      },
      route: {
        type: String,
        value: ''
      },
      data: {
        type: Array,
        value: function() { return []; },
        notify: true
      },

      requestQueue: {
        type: Array,
        value: function () {
          return [];
        }
      },

      loadOnStartup: {
        type: Boolean,
        value: false,
      }
    };
  }
  static get observers() {
    return [
      '__dataSplices(data.splices)',
      '__dataChanges(data.*)'
    ];
  }

  static get constants() {
    return {
      BUNDLED_REQUESTS_TYPES: ['add', 'update'],
    };
  }

  connectedCallback() {
    this.dispatchEvent(new CustomEvent('data-service-ready', {detail: this.get('id'), bubbles: true, composed: true}));
  }

  load() {
    if (this.get('loadOnStartup')) {
      return this.__generateListRequest();
    }

    this.set('loaded', true);
    this.set('status', 'done');
    return Promise.resolve();
  }

  /**
   * Used to generate Add and Remove requests
   * @param {Object} cr - data needed to calculate what has changed
   * @private
   */
  __dataSplices(cr) {
    if (!cr) {
      return;
    }
    if (this.get('logging')) console.log('__dataSplices', cr);

    cr.indexSplices.forEach(i => {
      let o = i.object[i.index];
      if (i.addedCount > 0) {
        if (!o.__readonly__) {
          if (!o.id) {
            o.id = AppDb.Factory.getObjectId(); // don't trigger a notification
          }
          this.__generateAddRequest(o);
        } else {
          delete o.__readonly__;
        }
      }

      // i.object.forEach((a, idx) => {
      //   this.__generateAddRequest(this.get(`data.${idx}`));
      // });

      i.removed.forEach(r => {
        if (!r.__readonly__) {
          this.__generateRmRequest(r.id);
        } else {
          if (this.get('logging')) console.log(`Ignoring __readonly__ splice for ${r.id}`);
          delete r.__readonly__;
        }
      });
    });
  }

  /**
   * Used to update individual records
   * @param {Object} cr - definition of what's changed
   * @private
   */
  __dataChanges(cr) {
    if (this.__internalChange__) {
      if (this.get('logging')) console.log(`Internal Change: ${this.__internalChange}`, cr);
      delete this.__internalChange__;
      return;
    }
    if (/\.length$/.test(cr.path) === true) {
      return;
    }

    if (this.get('logging')) console.log('__dataChanges: ', cr);
    // Ignore mutations on the whole array
    // if (cr.base.length !== 1) {
    //   return;
    // }

    // ignore paths with fields with __ as prefix and suffix
    if (/__(\w+)__/.test(cr.path)) {
      if (this.get('logging')) console.log(`Ignoring internal change: ${cr.path}`);
      return;
    }

    let path = cr.path.split('.');
    // Is this an array mutation?
    if (/\.splices$/.test(cr.path) === true) {
      if (path.length < 4) {
        if (this.get('logging')) console.log('Ignoring path too short:', path);
        return;
      }

      let entity = this.get(path.slice(0,2));
      // let index = path[1].replace('#', '');
      // if (!cr.base[index]) {
      //   if (this.get('logging')) console.log(`Ignoring: invalid change index: ${index}`);
      //   return;
      // }
      // let entity = cr.base[index];

      // Ignore a one-off readonly change (remove the field afterwards)
      if (entity.__readOnlyChange__) {
        if (this.get('logging')) console.log(`Ignoring readonly change: ${cr.path}`);
        delete entity.__readOnlyChange__;
        return;
      }

      if (this.get('logging')) console.log('Child array mutation', cr);

      if (this.get('logging')) console.log('Key Splices: ', cr.value.indexSplices.length);

      cr.value.indexSplices.forEach(i => {
        let o = i.object[i.index];
        if (i.addedCount > 0) {
          path.splice(0,2);
          path.splice(-1,1);
          // if (this.get('logging')) console.log('Update request', entity.id, path.join('.'), cr.value);
          if (typeof o === 'object' && !o.id) {
            o.id = AppDb.Factory.getObjectId();
          }
          this.__generateUpdateRequest(entity.id, path.join('.'), o);
        } else if (i.removed.length > 0){
          if(i.removed.length > 1) {
            if (this.get('logging')) console.log('Index splice removed.length > 1', i.removed);
          } else {
            path.splice(0, 2);
            path.splice(-1, 1);
            path.push(i.index);
            path.push('__remove__');

            this.__generateUpdateRequest(entity.id, path.join('.'), '');
          }
        }
      });

      if (cr.value.indexSplices.length || !cr.value.keySplices) {
        return;
      }

      if (this.get('logging')) console.log('Key Splices: ', cr.value.keySplices.length);

      cr.value.keySplices.forEach((k, idx) => {
        k.removed.forEach(() => {
          let itemIndex = cr.value.indexSplices[idx].index;
          if (this.get('logging')) console.log(itemIndex);

          path.splice(0, 2); // drop the prefix
          path.splice(-1, 1); // drop the .splices
          path.push(itemIndex); // add the correct index

          // path.push(k.replace('#', ''));
          path.push('__remove__'); // add the remove command
          this.__generateUpdateRequest(entity.id, path.join('.'), '');
        });
      });
    } else {
      if (path.length < 3) {
        // if (this.get('logging')) console.log('Ignoring path too short:', path);
        return;
      }
      let entity = this.get(path.slice(0,2));

      // let index = path[1].replace('#', '');
      if (!entity) {
        if (this.get('logging')) console.log(`Ignoring: invalid change index: ${path.slice(0,2)}`);
        return;
      }

      // let entity = cr.base[index];
      // Ignore a one-off readonly change (remove the field afterwards)
      if (entity.__readOnlyChange__) {
        if (this.get('logging')) console.log(`Ignoring readonly change: ${cr.path}`);
        delete entity.__readOnlyChange__;
        return;
      }

      let pathPrefix = path.splice(0, 2).join('.');
      path.forEach((p, idx) => {
        const rex = /^#\d+$/;
        // Is this an assignment directly into an array item?
        if (rex.test(p)) {
          // Grab the base array
          let arr = this.get(pathPrefix);
          // Get the item
          let item = this.get(`${pathPrefix}.${p}`);
          // Replace the 'opaque key' with the correct array index
          path[idx] = arr.indexOf(item);
        }
        pathPrefix += `.${p}`;
      });

      // path.splice(0,2);

      // let tail = path[path.length-1];
      // const rex = /#\d+$/;
      // // Is this an assignment directly into an array item?
      // if (rex.test(tail)) {
      //   // Look up the item
      //   let item = this.get(path);
      //   // Grab the base array
      //   let arr = this.get(path.slice(0,-1));
      //   // Replace the 'opaque key' with the correct array index
      //   path[path.length-1] = arr.indexOf(item);
      // }


      // if (this.get('logging')) console.log('Update request', entity.id, path.join('.'), cr.value);
      this.__generateUpdateRequest(entity.id, path.join('.'), cr.value);
    }
  }

  getEntity(id) {
    return this.__generateGetRequest(id);
  }
  getAllEntities() {
    return this.__generateListRequest();
  }
  search(query, limit = 0, skip = 0, sort, project=null) {
    return this.__generateSearchRequest(query, limit, skip, sort, project);
  }
  count(query) {
    return this.__generateCountRequest(query);
  }

  __generateListRequest() {
    return this.__queueRequest({
      type: 'list',
      url: this.vectorBaseUrl(),
      method: 'GET'
    });
  }
  __generateGetRequest(entityId) {
    if (this.get('logging')) console.log(`get rq: ${entityId}`);

    return this.__queueRequest({
      type: 'get',
      url: this.scalarBaseUrl(entityId),
      entityId: entityId,
      method: 'GET'
    });
  }
  __generateSearchRequest(query, limit = 0, skip = 0, sort, project) {
    if (this.get('logging')) console.log(`get rq: ${query}`);

    return this.__queueRequest({
      type: 'search',
      url: this.vectorBaseUrl(),
      method: 'SEARCH',
      body: {
        query,
        limit,
        skip,
        sort,
        project,
      },
    });
  }
  __generateCountRequest(query) {
    return this.__queueRequest({
      type: 'count',
      url: `${this.vectorBaseUrl()}/count`,
      method: 'SEARCH',
      body: {
        query,
      },
    });
  }
  __generateRmRequest(entityId) {
    if (this.get('logging')) console.log(`remove rq: ${entityId}`);

    return this.__queueRequest({
      type: 'delete',
      url: this.scalarBaseUrl(entityId),
      entityId: entityId,
      method: 'DELETE',
    });
  }
  __generateAddRequest(entity) {
    if (this.get('logging')) console.log(`add rq: ${entity.name}`);

    return this.__queueRequest({
      type: 'add',
      url: this.vectorBaseUrl(),
      entityId: -1,
      method: 'POST',
      contentType: 'application/json',
      body: entity
    });
  }
  __generateUpdateRequest(entityId, path, value) {
    if (this.get('logging')) console.log('update rq:', entityId, path, value);

    return this.__queueRequest({
      type: 'update',
      url: this.scalarBaseUrl(entityId),
      entityId: entityId,
      method: 'PUT',
      contentType: 'application/json',
      body: {
        path: path,
        value: value
      }
    });
  }

  __queueRequest(request) {
    return new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;

      this.requestQueue.push(request);
      this.__updateQueue();
    });
  }

  __updateQueue() {
    if (this.requestQueue.length === 0) {
      return;
    }

    if (this.status === 'working') {
      return;
    }
    
    this._dataServiceDebouncer = Debouncer.debounce(
      this._dataServiceDebouncer,
      timeOut.after((this.get('settings.bundled_requests')) ? 500 : 1),
      () => this.__reduceRequests()
    );
  }

  __reduceRequests() {
    const settings = this.get('settings');
    this.status = 'working';

    const requestIdx = this.requestQueue.findIndex((r) => r.type === 'add' || r.type === 'delete');
    let request = (requestIdx !== -1 && settings.bundled_requests) ? this.requestQueue.splice(requestIdx, 1).shift() : this.requestQueue.shift();

    // Attempt to reduce matching request types down to a single request
    if (settings.bundled_requests && ButtressDbDataService.constants.BUNDLED_REQUESTS_TYPES.includes(request.type)) {
      if (this.get('logging')) console.log('bulk compatible request, trying to chunk:', request.type);
      const requests = [
        request,
        ...this.requestQueue.filter((r) => r.type === request.type)
          .splice(0, settings.bundled_requests_chunk - 1)
      ];

      if (requests.length > 1) {
        this.requestQueue = this.requestQueue.filter((r) => !requests.includes(r));

        request = {
          type: `bulk/${request.type}`,
          url: `${this.vectorBaseUrl()}/bulk/${request.type}`,
          entityId: -1,
          method: 'POST',
          contentType: 'application/json',
          body: null,
          dependentRequests: requests,
        };

        if (request.type === 'bulk/update') {
          request.body = requests.map((rq) => {
            return {
              id: rq.entityId,
              body: rq.body
            };
          });
        } else {
          request.body = requests.map((rq) => rq.body);
        }
      }
    }

    return this.__generateRequest(request);
  }

  __generateRequest(rq) {
    const token = this.get('token');

    return fetch(`${rq.url}?urq=${Date.now()}&token=${token}`, {
      method: rq.method,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      },
      body: (rq.body) ? JSON.stringify(rq.body) : null,
    })
      .then((response) => {
        if (response.ok) {
          return response.json();
        } else {
          // Handle Buttress Error
          if (response.status === 401) {
            this.status = 'done';
            Buttress.clearSearchLoadedCollection(this.id);
          }

          throw new Error(`DS ERROR [${rq.type}] ${response.status} ${rq.url} - ${response.statusText}`);
        }
      })
      .then((a) => this.__ajaxResponse(a, rq))
      .catch((err) => {
        // will only reject on network failure or if anything prevented the request from completing.
        console.error(err);
        this.dispatchEvent(new CustomEvent('bjs-ds-error', {
          detail: {
            error: err,
            type: rq.type,
            url: rq.url,
            entityId: rq.entityId,
            method: rq.method,
            body,
          },
          bubbles: true,
          composed: true,
        }));
        if (rq.reject) rq.reject(err);
        if (rq.dependentRequests) rq.dependentRequests.forEach((rq) => rq.reject(err));
        this.status = 'error';

        this.__updateQueue();
      });
  }

  __ajaxResponse(response, rq) {
    if (!rq) {
      if (this.get('logging')) console.log('warn', 'Response on an empty requestQueue!!!');
      return;
    }

    rq.response = response;
    switch (rq.type) {
      default:
        break;
      case 'get':
        this.__ajaxGetResponse(rq);
        break;
      case 'list':
        this.__ajaxListResponse(rq);
        break;
      case 'search':
        this.__ajaxSearchResponse(rq);
        break;
      // case 'update': {
      //   this.__ajaxUpdateResponse(rq);
      // } break;
      // case 'add': {
      //   this.__ajaxAddResponse(rq);
      // } break;
    }

    this.status = 'done';
    if (rq.resolve) rq.resolve(response);
    if (rq.dependentRequests) rq.dependentRequests.forEach((rq) => rq.resolve(response));
    this.__updateQueue();
  }

  __ajaxGetResponse(rq) {
    const entity = rq.response;
    if (this.get('logging')) console.log('__ajaxGetResponse', entity);
    if (!entity) return;

    const idx = this.data.findIndex(((e) => e.id === entity.id));
    if (idx !== -1) return;

    entity.__readonly__ = true;
    this.push('data', entity);
  }

  __ajaxListResponse(rq) {
    if (this.get('logging')) console.log('__ajaxListResponse', rq);
    this.__internalChange__ = true;
    this.data = rq.response;
    this.set('loaded', true);
  }

  __ajaxSearchResponse(rq) {
    const entites = rq.response;
    if (this.get('logging')) console.log('__ajaxListResponse', rq);
    if (!entites || entites.length < 1) return;

    const missingEntites = entites.filter((entity) => this.data.findIndex((e) => e.id === entity.id) === -1);
    if (missingEntites.length < 1) return;

    if (rq.body && rq.body.project) return;

    this.__internalChange__ = true;
    this.data = this.data.concat(missingEntites);
    this.set('loaded', true);
  }

  __ajaxAddResponse(rq) {
    let data = this.data;
    for (let x=0; x<data.length; x++) {
      if (!data[x].id) {
        this.data[x].__readOnlyChange__ = true;
        this.set(['data', x, 'id'], rq.response.id);
        break;
      }
    }
  }

  __ajaxUpdateResponse(rq) {
    if (this.get('logging')) console.log('__ajaxUpdateResponse', rq);
    const responses = rq.response;
    responses.forEach(r => {
      if (!(r.value instanceof Object) || r.type !== 'vector-add' || !r.value.id) {
        if (this.get('logging')) console.log('update early out', r.value instanceof Object);
        return;
      }
      let idx = this.get('data').findIndex(e => e.id == rq.entityId); //eslint-disable-line eqeqeq
      if (idx === -1) {
        if (this.get('logging')) console.log('warn', 'Invalid entity id', rq.entityId);
        return;
      }
      let base = this.get(['data', idx, r.path]);
      if (this.get('logging')) console.log(['data', idx, r.path], base);
      if (base instanceof Array) {
        for (let x=0; x<base.length; x++) {
          if (!base[x].id) {
            if (base[x].name !== undefined && r.value.name === base[x].name) {
              if (this.get('logging')) console.log('Setting array item id using item name', r.value.id, r.value.name);
              this.data[idx].__readOnlyChange__ = true;
              if (this.get('logging')) console.log(['data', idx, rq.body.path, x, 'id']);
              this.set(['data', idx, rq.body.path, x, 'id'], r.value.id);

              break;
            } else if (base[x].name === undefined) {
              this.data[idx].__readOnlyChange__ = true;
              if (this.get('logging')) console.log(['data', idx, rq.body.path, x, 'id']);
              this.set(['data', idx, rq.body.path, x, 'id'], r.value.id);

              break;
            }
          }
        }
      }
    });
  }

  vectorBaseUrl() {
    const endpoint = this.get('endpoint');
    const route = this.get('route');

    if (!this.get('core') && this.get('apiPath')) {
      return `${endpoint}/${this.get('apiPath')}/api/v1/${route}`;
    }

    return `${endpoint}/api/v1/${route}`;
  }
  scalarBaseUrl(entityId) {
    const endpoint = this.get('endpoint');
    const route = this.get('route');

    if (!this.get('core') && this.get('apiPath')) {
      return `${endpoint}/${this.get('apiPath')}/api/v1/${route}/${entityId}`;
    }

    return `${endpoint}/api/v1/${route}/${entityId}`;
  }
}
window.customElements.define(ButtressDbDataService.is, ButtressDbDataService);