import type { CodegenConfig } from '@graphql-codegen/cli';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const HASURA_URL =
  process.env.HASURA_GRAPHQL_URL || 'http://localhost:6565/v1/graphql';

const config: CodegenConfig = {
  generates: {
    './gql/graphql.ts': {
      schema: [
        {
          [HASURA_URL]: {
            headers: {
              'x-hasura-admin-secret': process.env.HASURA_GRAPHQL_ADMIN_SECRET!,
              'x-hasura-role': 'admin',
            },
          },
        },
      ],
      documents: ['./src/**/query.graphql'],
      plugins: [
        'typescript',
        'typescript-operations',
        'typescript-react-apollo',
      ],
      config: {
        dedupeFragments: true,
      },
    },
  },
};

export default config;
