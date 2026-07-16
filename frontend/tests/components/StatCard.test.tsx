import { render, screen } from "@testing-library/react";
import { Briefcase } from "lucide-react";
import { describe, expect, it } from "vitest";
import { StatCard } from "@/components/analytics/StatCard";

describe("StatCard", () => {
  it("renders label and value", () => {
    render(<StatCard label="Total Applied" value={12} icon={Briefcase} />);
    expect(screen.getByText("Total Applied")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders a suffix when provided", () => {
    render(
      <StatCard label="Response Rate" value={40} suffix="%" icon={Briefcase} />,
    );
    expect(screen.getByText(/40/)).toBeInTheDocument();
    expect(screen.getByText(/%/)).toBeInTheDocument();
  });
});
