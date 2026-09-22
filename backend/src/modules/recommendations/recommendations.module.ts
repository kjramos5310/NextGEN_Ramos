import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AIRecommendation } from './entities/recommendation.entity';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsController } from './recommendations.controller';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Module({
  imports: [TypeOrmModule.forFeature([AIRecommendation])],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, CustomLoggerService],
  exports: [RecommendationsService, TypeOrmModule],
})
export class RecommendationsModule {}
