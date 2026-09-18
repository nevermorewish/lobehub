import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  shell: css`
    min-height: 100vh;
    background: ${cssVar.colorBgLayout};
    color: ${cssVar.colorText};
  `,
  sidebar: css`
    overflow-y: auto;
    width: 240px;
    position: fixed;
    inset: 0 auto 0 0;
    padding: 32px 16px;
    background: ${cssVar.colorBgContainer};
    border-right: 1px solid ${cssVar.colorBorderSecondary};
    z-index: 2;
    @media (max-width: 800px) {
      position: static;
      width: auto;
      border-right: 0;
      border-bottom: 1px solid ${cssVar.colorBorderSecondary};
      padding: 16px;
    }
  `,
  brand: css`
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.4px;
  `,
  muted: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 14px;
  `,
  nav: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 32px;
    @media (max-width: 800px) {
      flex-direction: row;
      flex-wrap: wrap;
      margin-top: 16px;
    }
  `,
  navItem: css`
    justify-content: flex-start !important;
    width: 100%;
    height: 44px !important;
    @media (max-width: 800px) {
      width: auto;
    }
  `,
  main: css`
    margin-left: 240px;
    min-width: 0;
    padding: 32px;
    @media (max-width: 800px) {
      margin-left: 0;
      padding: 16px;
    }
  `,
  content: css`
    max-width: 1440px;
    margin: 0 auto;
  `,
  header: css`
    padding-bottom: 24px;
    h1 {
      font-size: 28px;
      margin: 0 0 8px;
      font-weight: 600;
    }
    p {
      margin: 0;
      color: ${cssVar.colorTextSecondary};
    }
  `,
  card: css`
    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    padding: 24px;
    min-width: 0;
  `,
  toolbar: css`
    padding-bottom: 20px;
  `,
  table: css`
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    @media (max-width: 800px) {
      min-width: 680px;
    }
    th {
      text-align: left;
      white-space: nowrap;
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorBgLayout};
    }
    td,
    th {
      padding: 16px;
      border-bottom: 1px solid ${cssVar.colorBorderSecondary};
    }
    td {
      vertical-align: middle;
    }
    tbody tr:last-child td {
      border-bottom: 0;
    }
    tbody tr:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  scroll: css`
    overflow-x: auto;
  `,
  number: css`
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  `,
  badge: css`
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    border-radius: 6px;
    padding: 4px 8px;
    background: ${cssVar.colorFillTertiary};
    white-space: nowrap;
  `,
  good: css`
    color: ${cssVar.colorSuccessText};
    background: ${cssVar.colorSuccessBg};
  `,
  bad: css`
    color: ${cssVar.colorErrorText};
    background: ${cssVar.colorErrorBg};
  `,
  empty: css`
    padding: 64px 24px;
    text-align: center;
    color: ${cssVar.colorTextSecondary};
  `,
  error: css`
    padding: 16px;
    background: ${cssVar.colorErrorBg};
    color: ${cssVar.colorErrorText};
    border-radius: 8px;
  `,
  success: css`
    padding: 12px 16px;
    background: ${cssVar.colorSuccessBg};
    color: ${cssVar.colorSuccessText};
    border-radius: 8px;
  `,
  editor: css`
    margin-bottom: 24px;
    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 12px;
    padding: 24px;
    h2 {
      margin: 0;
      font-size: 18px;
    }
  `,
  fields: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
    @media (max-width: 650px) {
      grid-template-columns: 1fr;
    }
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    label {
      font-size: 14px;
      font-weight: 500;
    }
    small {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 24px;
  `,
  login: css`
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: ${cssVar.colorBgLayout};
  `,
  loginCard: css`
    width: 420px;
    padding: 40px;
    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;
    h1 {
      font-size: 24px;
      margin: 0;
    }
  `,
}));
