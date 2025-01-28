import { defaultNetworkId, NetworkId } from './networks';

export const EXTERNAL_ROUTES = {
  autonomys: 'https://autonomys.xyz/',
  academy: 'https://academy.autonomys.xyz/',
  privacyPolicy: 'https://www.autonomys.xyz/privacy-policy',
  forum: 'https://forum.autonomys.xyz/',
  docs: 'https://docs.autonomys.xyz/',
  status: 'https://status.autonomys.xyz/',
  operatorDocs: 'https://docs.autonomys.xyz/staking/operator/register',
  autoDriveDocs:
    'https://github.com/autonomys/auto-sdk/tree/main/packages/auto-drive',
  social: {
    twitter: 'https://x.com/AutonomysNet',
    discord: 'https://autonomys.xyz/discord',
    telegram: 'https://t.me/subspace_network',
    github: 'https://github.com/autonomys',
    reddit: 'https://www.reddit.com/r/autonomys',
    medium: 'https://medium.com/subspace-network',
    youtube: 'https://www.youtube.com/@AutonomysNetwork',
    linkedin: 'https://www.linkedin.com/company/autonomys/',
    subSocial: 'https://app.subsocial.network/@NetworkSubspace',
  },
  novaExplorer: 'https://nova.subspace.network/',
  subscan: 'https://autonomys.subscan.io/',
  spaceAcres:
    'https://api.github.com/repos/autonomys/space-acres/releases/latest',
};

export const ROUTES = {
  drive: (networkId: NetworkId = defaultNetworkId) => {
    return `/${networkId}/drive`;
  },
  onboarding: () => {
    return '/onboarding';
  },
  search: (networkId: NetworkId, query: string) => {
    return `/${networkId}/drive/search/${encodeURIComponent(query)}`;
  },
  objectDetails: (networkId: NetworkId, cid: string) => {
    return `/${networkId}/drive/metadata/${cid}`;
  },
  fs: (networkId: NetworkId, cid: string) => {
    return `/${networkId}/drive/fs/${cid}`;
  },
};
