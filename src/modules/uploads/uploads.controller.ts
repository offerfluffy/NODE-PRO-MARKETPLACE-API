import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import type { AccessTokenClaims } from '../auth/types/auth.types.js';
import {
  commitUploadSchema,
  createUploadIntentSchema,
  type CommitUploadDto,
  type CreateUploadIntentDto,
} from './dto/upload.dto.js';
import {
  UploadsService,
  type CommitUploadResult,
  type CreateUploadIntentResult,
} from './services/uploads.service.js';

@Controller('uploads')
@UseGuards(AccessTokenGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('intent')
  @HttpCode(HttpStatus.OK)
  createIntent(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createUploadIntentSchema))
    body: CreateUploadIntentDto,
  ): Promise<CreateUploadIntentResult> {
    // Intentionally ignore body.filename so clients never control object keys.
    return this.uploadsService.createIntent({
      userId: user.sub,
      contentType: body.contentType,
      size: body.size,
    });
  }

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  commit(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(commitUploadSchema))
    body: CommitUploadDto,
  ): Promise<CommitUploadResult> {
    return this.uploadsService.commit({
      userId: user.sub,
      fileId: body.fileId,
    });
  }
}
