import { ApiProperty } from '@nestjs/swagger';
import { GroupMemberItemDto } from '@api/common/group/dto/group-member-item.dto';

export class GroupMembersResponseDto {
  @ApiProperty({ description: 'page', example: 1, type: Number })
  page!: number;
  @ApiProperty({ description: 'pageSize', example: 50, type: Number })
  pageSize!: number;
  @ApiProperty({ description: 'total', example: 100, type: Number })
  total!: number;
  @ApiProperty({ description: 'list', type: [GroupMemberItemDto] })
  list!: GroupMemberItemDto[];
}
