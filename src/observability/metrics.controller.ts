import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { MetricsService } from './metrics.service';

@ApiTags('observability')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Prometheus metrics' })
  async scrape(@Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    void reply.header('content-type', this.metrics.registry.contentType);
    return this.metrics.registry.metrics();
  }
}
