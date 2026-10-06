import { Module } from '@nestjs/common';
import { CitationsModule } from '../citations/citations.module.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsRepository } from './conversations.repository.js';
import { ConversationsService } from './conversations.service.js';

@Module({
  imports: [CitationsModule],
  controllers: [ConversationsController],
  providers: [ConversationsRepository, ConversationsService],
  exports: [ConversationsRepository, ConversationsService],
})
export class ConversationsModule {}
