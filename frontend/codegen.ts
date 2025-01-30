import type { CodegenConfig } from '@graphql-codegen/cli';
import * as dotenv from 'dotenv';

dotenv.config();

const config: CodegenConfig = {
  generates: {
    './gql/graphql.ts': {
      schema: 'https://demo.auto-drive.autonomys.xyz/hasura/v1/graphql',
      documents: ['./src/**/query.ts'],
      plugins: [
        'typescript',
        'typescript-operations',
        'typescript-react-apollo',
      ],
    },
  },
};

export default config;
