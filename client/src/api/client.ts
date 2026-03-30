import axios from 'axios';
import { msalInstance, apiScopes } from '../auth/msalConfig';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach Azure AD Bearer token to every request (if authenticated)
api.interceptors.request.use(async (config) => {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    try {
      const response = await msalInstance.acquireTokenSilent({
        scopes: apiScopes,
        account: accounts[0],
      });
      config.headers.Authorization = `Bearer ${response.accessToken}`;
    } catch {
      // Silent token acquisition failed — will redirect to login
    }
  }
  return config;
});

export default api;
