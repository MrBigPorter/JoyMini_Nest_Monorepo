import { ApiProperty } from '@nestjs/swagger';

export class ClearUserDataResponseDto {
  @ApiProperty({ description: 'Whether the account was soft-deleted' })
  accountDeleted!: boolean;

  @ApiProperty({ description: 'Number of comments anonymized' })
  anonymizedComments!: number;

  @ApiProperty({ description: 'Number of bookmarks deleted' })
  deletedBookmarks!: number;
}
