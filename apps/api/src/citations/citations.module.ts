import { Module } from '@nestjs/common';
import { CitationsController } from './citations.controller.js';
import { CitationsRepository } from './citations.repository.js';

@Module({
  controllers: [CitationsController],
  providers: [CitationsRepository],
  exports: [CitationsRepository],
})
export class CitationsModule {}
