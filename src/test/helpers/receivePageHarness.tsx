import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { ReceivePage } from "../../pages/ReceivePage";

export const PACKAGE_ROUTE_TEST_ID = "package-route";

function PackageRouteProbe() {
  const { id } = useParams();
  return <p data-testid={PACKAGE_ROUTE_TEST_ID}>{id}</p>;
}

export function renderReceivePage(options?: { includePackageRoute?: boolean }) {
  const includePackageRoute = options?.includePackageRoute ?? false;
  return render(
    <MemoryRouter initialEntries={["/receive"]}>
      <Routes>
        <Route path="/receive" element={<ReceivePage />} />
        {includePackageRoute ? <Route path="/receive/:id" element={<PackageRouteProbe />} /> : null}
      </Routes>
    </MemoryRouter>,
  );
}
