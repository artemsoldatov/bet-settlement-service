import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

// AppModule reads env at import time, so it must load after the container is up.
// init() triggers lifecycle hooks (PrismaService.$connect).
export async function createTestContext(): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  return moduleRef;
}
