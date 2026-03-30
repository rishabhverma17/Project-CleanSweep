import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

const msalConfig: Configuration = {
  auth: {
    clientId: '572f7365-b23b-4ec7-b5bd-979c51eca7b4',
    authority: 'https://login.microsoftonline.com/142f4152-4ed6-4d13-8909-1af6bfa0b659',
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

export const loginRequest = {
  scopes: ['api://572f7365-b23b-4ec7-b5bd-979c51eca7b4/access'],
};

export const apiScopes = ['api://572f7365-b23b-4ec7-b5bd-979c51eca7b4/access'];
