import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { createTestConfig } from './testing/test-config.js';

describe('AppModule', () => {
  it('compiles the API application module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(createTestConfig())],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
