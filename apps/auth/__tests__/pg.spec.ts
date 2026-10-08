import { jest } from '@jest/globals'

const mockConnect = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockQuery = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({ rows: [] })
const mockEnd = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockClientInstances: any[] = []

const mockGetDbConnectAuthToken = jest
  .fn<() => Promise<string>>()
  .mockResolvedValue('runtime-token-123')
const mockGetDbConnectAdminAuthToken = jest
  .fn<() => Promise<string>>()
  .mockResolvedValue('admin-token-456')

jest.unstable_mockModule('pg', () => {
  class MockClient {
    public connect = mockConnect
    public query = mockQuery
    public end = mockEnd
    public config: any

    constructor(config: any) {
      this.config = config
      mockClientInstances.push(this)
    }
  }

  return {
    default: {
      Client: MockClient,
    },
  }
})

jest.unstable_mockModule('@aws-sdk/dsql-signer', () => {
  class MockDsqlSigner {
    public getDbConnectAuthToken = mockGetDbConnectAuthToken
    public getDbConnectAdminAuthToken = mockGetDbConnectAdminAuthToken
  }

  return {
    DsqlSigner: MockDsqlSigner,
  }
})

describe('DSQL and PostgreSQL database driver connections', () => {
  process.env.JWT_SECRET = 'test'
  process.env.JWT_SECRET_ALGORITHM = 'HS256'
  process.env.API_SECRET = 'test'
  process.env.DEBUG_LEVEL = 'error'
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    mockClientInstances.length = 0
    process.env = {
      ...originalEnv,
      JWT_SECRET: 'test',
      JWT_SECRET_ALGORITHM: 'HS256',
      API_SECRET: 'test',
      DEBUG_LEVEL: 'error',
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('createDSQLConnection should use getDbConnectAuthToken with runtime user', async () => {
    process.env.DSQL_CLUSTER_ENDPOINT = 'test-cluster.dsql.us-east-1.on.aws'
    process.env.AWS_REGION = 'us-east-1'
    process.env.DSQL_CLUSTER_USER = 'app_runtime_user'

    const { createDSQLConnection } = await import('../src/drivers/pg.js')
    const client = await createDSQLConnection()

    expect(mockGetDbConnectAuthToken).toHaveBeenCalled()
    expect(mockConnect).toHaveBeenCalled()
    expect((client as any).config.user).toBe('app_runtime_user')
    expect((client as any).config.password).toBe('runtime-token-123')
  })

  it('createDSQLAdminConnection should use getDbConnectAdminAuthToken with admin user', async () => {
    process.env.DSQL_CLUSTER_ENDPOINT = 'test-cluster.dsql.us-east-1.on.aws'
    process.env.AWS_REGION = 'us-east-1'
    process.env.DSQL_CLUSTER_ADMIN_USER = 'admin'

    const { createDSQLAdminConnection } = await import('../src/drivers/pg.js')
    const client = await createDSQLAdminConnection()

    expect(mockGetDbConnectAdminAuthToken).toHaveBeenCalled()
    expect(mockConnect).toHaveBeenCalled()
    expect((client as any).config.user).toBe('admin')
    expect((client as any).config.password).toBe('admin-token-456')
  })

  it('createDB should branch on DSQL_CLUSTER_ENDPOINT', async () => {
    delete process.env.DSQL_CLUSTER_ENDPOINT

    const { createDB, createAdminDB } = await import('../src/drivers/pg.js')
    const pgClient = await createDB()
    expect(pgClient).toBeDefined()
    expect(mockConnect).toHaveBeenCalled()

    const pgAdminClient = await createAdminDB()
    expect(pgAdminClient).toBeDefined()
  })
})
