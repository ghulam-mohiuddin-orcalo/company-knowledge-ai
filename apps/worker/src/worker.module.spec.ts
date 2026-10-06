import { Test } from '@nestjs/testing';
import { WorkerModule } from './worker.module.js';

describe('WorkerModule', () => {
  it('compiles the worker application module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
