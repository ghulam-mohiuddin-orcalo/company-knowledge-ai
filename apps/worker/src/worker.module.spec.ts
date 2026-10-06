import { Test } from '@nestjs/testing';
import { createTestWorkerConfig } from './testing/test-config.js';
import { WorkerLoop } from './worker-loop.js';
import { WorkerModule } from './worker.module.js';

describe('WorkerModule', () => {
  it('compiles the worker application module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.forRoot(createTestWorkerConfig())],
    }).compile();

    expect(moduleRef.get(WorkerLoop)).toBeDefined();
    await moduleRef.close();
  });
});
