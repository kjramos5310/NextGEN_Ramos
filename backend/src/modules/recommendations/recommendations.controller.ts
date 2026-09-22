import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import { RecommendationType } from './entities/recommendation.entity';

@Controller('api/v1/recommendations')
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Get()
  async findAll() {
    return this.recommendationsService.findAll();
  }

  @Get('account/:accountNumber')
  async findByAccount(@Param('accountNumber') accountNumber: string) {
    return this.recommendationsService.findByAccount(accountNumber);
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string) {
    return this.recommendationsService.markAsRead(id);
  }

  @Post()
  async createDirectly(
    @Body()
    body: {
      accountNumber: string;
      transactionId?: string;
      type: RecommendationType;
      title: string;
      message: string;
      confidenceScore?: number;
      metadata?: Record<string, any>;
    },
  ) {
    return this.recommendationsService.create(body);
  }
}
