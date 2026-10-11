import axios from "axios";

const baseURL = "/api/bins";

async function getAllBins() {
  const bins = await axios.get(baseURL);
  return bins.data;
}

async function postBin(endpoint) {
  const addedBin = await axios.post(baseURL, {
    url_endpoint: endpoint,
  });
  return addedBin.data;
}

async function getAllRequests(endpoint) {
  const requests = await axios.get(`${baseURL}/${endpoint}/requests`);
  return requests.data;
}

// get request by id
async function getRequestById(endpoint, requestId) {
  const request = await axios.get(
    `${baseURL}/${endpoint}/requests/${requestId}/raw`,
  );
  return request.data;
}

async function getResponseConfig(endpoint) {
  const config = await axios.get(`${baseURL}/${endpoint}/response-config`);
  return config.data;
}

async function setResponseStatus(endpoint, responseStatus) {
  const config = await axios.put(`${baseURL}/${endpoint}/response-config`, {
    response_status: responseStatus,
  });
  return config.data;
}

export default {
  getResponseConfig,
  setResponseStatus,
  getAllBins,
  postBin,
  getAllRequests,
  getRequestById,
};
