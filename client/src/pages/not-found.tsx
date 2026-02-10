import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex items-center justify-center h-full p-6">
      <Card className="max-w-sm w-full">
        <CardContent className="p-6 text-center space-y-3">
          <p className="text-4xl font-bold text-muted-foreground/20">404</p>
          <p className="text-sm font-medium">Page not found</p>
          <p className="text-xs text-muted-foreground">
            The page you're looking for doesn't exist.
          </p>
          <Link href="/">
            <Button variant="outline" size="sm" className="gap-1.5 mt-2" data-testid="button-go-home">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
