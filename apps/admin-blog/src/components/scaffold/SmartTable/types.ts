import { ReactNode } from 'react';

// 1. 支持的数值类型 (增加了 dateRange)
export type ValueType =
  | 'text'
  | 'money'
  | 'date'
  | 'dateTime'
  | 'dateRange'
  | 'select'
  | 'option'
  | 'index';

// 修复点 2：更新 valueEnumType 定义
// 使用索引签名 [key: string | number]，同时支持数字和字符串 Key
export type valueEnumType = {
  [key: string | number]: ValueEnumItem;
};

// 修复点 1：定义统一的枚举项类型
// 既可以是简单的 ReactNode (字符串/组件)，也可以是配置对象
export type ValueEnumItem =
  | ReactNode
  | {
      text: string;
      status?: string;
      color?: string;
    };

// 2. ActionRef 定义
export type ActionType = {
  reload: (resetPageIndex?: boolean) => void;
  reset: () => void;
};

// 3. 请求函数定义
export type RequestData<T> = (params: {
  pageSize: number;
  page: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}) => Promise<{
  data: T[];
  total: number;
  success?: boolean;
}>;

// 4. 列定义 (增加了 copyable 和 formItemProps)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProColumns<T = any> = {
  title: string;
  dataIndex?: keyof T | string;
  width?: number;
  valueType?: ValueType;

  // ✨ 新增：支持复制
  copyable?: boolean;

  // 枚举映射
  valueEnum?: valueEnumType;

  // 搜索配置
  search?:
    | boolean
    | {
        order?: number;
        title?: string;
        valueType?: ValueType;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transform?: (value: any) => any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formItemProps?: Record<string, any>;
      };

  hideInTable?: boolean;
  hideInSearch?: boolean;

  render?: (
    dom: ReactNode,
    entity: T,
    index: number,
    action?: ActionType,
  ) => ReactNode;
};
