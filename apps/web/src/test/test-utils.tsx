import { render } from "@testing-library/react";
import type { ReactElement } from "react";

export const renderApp = (ui: ReactElement) => render(ui);
