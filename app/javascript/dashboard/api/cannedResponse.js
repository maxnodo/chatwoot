import CacheEnabledApiClient from './CacheEnabledApiClient';

class CannedResponse extends CacheEnabledApiClient {
  constructor() {
    super('canned_responses', { accountScoped: true });
  }

  // eslint-disable-next-line class-methods-use-this
  get cacheModelName() {
    return 'canned_response';
  }

  // The index endpoint returns a bare array instead of a payload wrapper
  // eslint-disable-next-line class-methods-use-this
  extractDataFromResponse(response) {
    return response.data;
  }

  // eslint-disable-next-line class-methods-use-this
  marshallData(dataToParse) {
    return { data: dataToParse };
  }

  create(data) {
    return axios.post(this.url, this.toFormData(data));
  }

  update(id, data) {
    return axios.patch(`${this.url}/${id}`, this.toFormData(data));
  }

  toFormData(data) {
    const formData = new FormData();
    formData.append('canned_response[short_code]', data.short_code);
    formData.append('canned_response[content]', data.content);
    (data.files || []).forEach(file => {
      formData.append('canned_response[files][]', file);
    });
    (data.remove_file_ids || []).forEach(id => {
      formData.append('canned_response[remove_file_ids][]', id);
    });
    return formData;
  }
}

export default new CannedResponse();
