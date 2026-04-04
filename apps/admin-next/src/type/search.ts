// 定义支持的表单类型
export type FieldType = 'input' | 'select' | 'date';

// 定义下拉选项
export interface Option {
  label: string;
  value: string;
}

// 单个字段的配置结构
export interface SearchFieldSchema<T> {
  /** 字段对应后端接口的 key (例如 'title', 'status') */
  key: keyof T;
  /** 显示的标签 (例如 '搜索标题') */
  label: string;
  /** 表单类型 */
  type: FieldType;
  /** 占位符 */
  placeholder?: string;
  /** 初始默认值 */
  defaultValue?: T[keyof T];
  /** 仅对 select 有效：选项列表 */
  options?: Option[];
  /** 额外的样式类名 (用于控制宽度等) */
  className?: string;
  /** 仅对 date 有效：是否显示时间选择 */
  showTime?: boolean;
  /** 仅对 date 有效：日期选择模式 */
  mode?: 'single' | 'range';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FormSchema<T = any> = SearchFieldSchema<T>;
