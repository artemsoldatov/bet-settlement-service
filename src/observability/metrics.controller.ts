import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async scrape(@Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    void reply.header('content-type', this.metrics.registry.contentType);
    return this.metrics.registry.metrics();
  }
}
