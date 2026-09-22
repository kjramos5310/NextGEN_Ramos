import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AIRecommendation, RecommendationType } from './entities/recommendation.entity';
import { CustomLoggerService } from '../../common/logger/logger.service';

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectRepository(AIRecommendation)
    private readonly recommendationRepository: Repository<AIRecommendation>,
    private readonly logger: CustomLoggerService,
  ) {}

  async findByAccount(accountNumber: string): Promise<AIRecommendation[]> {
    return this.recommendationRepository.find({
      where: { accountNumber },
      order: { createdAt: 'DESC' },
      take: 10,
    });
  }

  async findAll(): Promise<AIRecommendation[]> {
    return this.recommendationRepository.find({
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async create(data: {
    accountNumber: string;
    transactionId?: string;
    type: RecommendationType;
    title: string;
    message: string;
    confidenceScore?: number;
    metadata?: Record<string, any>;
  }): Promise<AIRecommendation> {
    // Consumidor idempotente: el outbox entrega at-least-once, un reenvío no duplica la recomendación
    if (data.transactionId) {
      const existing = await this.recommendationRepository.findOne({ where: { transactionId: data.transactionId } });
      if (existing) {
        this.logger.log(`Duplicate AI event ignored for transaction ${data.transactionId}`);
        return existing;
      }
    }

    const recommendation = this.recommendationRepository.create({
      ...data,
      confidenceScore: data.confidenceScore ?? 0.95,
      isRead: false,
    });

    const saved = await this.recommendationRepository.save(recommendation);
    this.logger.log(`New AI recommendation saved for account #${saved.accountNumber}: "${saved.title}"`);
    return saved;
  }

  async markAsRead(id: string): Promise<AIRecommendation> {
    const rec = await this.recommendationRepository.findOne({ where: { id } });
    if (!rec) {
      throw new NotFoundException(`Recomendación ${id} no encontrada`);
    }
    rec.isRead = true;
    return this.recommendationRepository.save(rec);
  }
}
